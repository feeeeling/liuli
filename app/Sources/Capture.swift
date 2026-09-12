import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import Vision

enum SelectionCapture {
    static func readSelectedText() async -> String? {
        Permissions.promptAccessibility()
        if let ax = axSelectedText(), !ax.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ax
        }
        return await clipboardFallback()
    }

    private static func axSelectedText() -> String? {
        let systemWide = AXUIElementCreateSystemWide()
        var focused: AnyObject?
        guard AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focused
        ) == .success, let focused else { return nil }

        let element = focused as! AXUIElement
        var selected: AnyObject?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selected) == .success,
           let text = selected as? String,
           !text.isEmpty
        {
            return text
        }
        return nil
    }

    private static func clipboardFallback() async -> String? {
        let backup = PasteboardBackup()
        postCommandC()
        try? await Task.sleep(for: .milliseconds(90))
        let text = NSPasteboard.general.string(forType: .string)
        backup.restore()
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text
        }
        return nil
    }

    private static func postCommandC() {
        let source = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: true)
        down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: false)
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }
}

private struct PasteboardBackup {
    let items: [[String: Data]]

    init() {
        items = NSPasteboard.general.pasteboardItems?.map { item in
            var dict: [String: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) {
                    dict[type.rawValue] = data
                }
            }
            return dict
        } ?? []
    }

    func restore() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        for dict in items {
            let item = NSPasteboardItem()
            for (key, value) in dict {
                item.setData(value, forType: NSPasteboard.PasteboardType(key))
            }
            pasteboard.writeObjects([item])
        }
    }
}

enum VisionOCR {
    static func recognize(_ image: NSImage) -> String {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
        var result = ""
        let request = VNRecognizeTextRequest { request, _ in
            let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
            result = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP", "ko-KR"]
        try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        return result
    }
}

enum ScreenCapture {
    static func image(rect cocoaRect: CGRect, excludingWindowNumbers: [Int] = []) async -> NSImage? {
        if cocoaRect.width < 2 || cocoaRect.height < 2 { return nil }
        let quartz = cocoaToQuartz(cocoaRect)
        // While our overlay is up, never use the display-wide still API — it includes the dimmer.
        if !excludingWindowNumbers.isEmpty {
            if let image = await captureFiltered(cocoaRect, excludingWindowNumbers: excludingWindowNumbers) {
                return image
            }
            return nil
        }
        if let image = await captureStill(quartz, size: cocoaRect.size) {
            return image
        }
        if let image = await captureFiltered(cocoaRect, excludingWindowNumbers: []) {
            return image
        }
        return screencaptureCLI(quartz)
    }

    /// Screenshot-only APIs. Do not use SCStreamConfiguration — that path can prompt for system audio / microphone.
    private static func captureStill(_ quartz: CGRect, size: CGSize) async -> NSImage? {
        if #available(macOS 26.0, *) {
            do {
                let config = SCScreenshotConfiguration()
                config.showsCursor = false
                let output = try await SCScreenshotManager.captureScreenshot(rect: quartz, configuration: config)
                if let cgImage = output.sdrImage {
                    return NSImage(cgImage: cgImage, size: size)
                }
            } catch {
                NSLog("[liuli] SCScreenshotConfiguration: \(error)")
            }
        }
        if #available(macOS 15.2, *) {
            do {
                let cgImage = try await SCScreenshotManager.captureImage(in: quartz)
                return NSImage(cgImage: cgImage, size: size)
            } catch {
                NSLog("[liuli] captureImage(in:): \(error)")
            }
        }
        return nil
    }

    private static func captureFiltered(_ cocoaRect: CGRect, excludingWindowNumbers: [Int]) async -> NSImage? {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let screen = NSScreen.screens.first(where: { $0.frame.intersects(cocoaRect) }) ?? NSScreen.main else {
                NSLog("[liuli] ScreenCaptureKit: no screen for rect \(cocoaRect)")
                return nil
            }
            let screenID = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
            guard let display = content.displays.first(where: { $0.displayID == screenID }) ?? content.displays.first else {
                NSLog("[liuli] ScreenCaptureKit: no display")
                return nil
            }
            let source = CGRect(
                x: cocoaRect.origin.x - screen.frame.origin.x,
                y: screen.frame.maxY - cocoaRect.maxY,
                width: cocoaRect.width,
                height: cocoaRect.height
            ).integral
            let exclude = content.windows.filter { excludingWindowNumbers.contains(Int($0.windowID)) }
            let filter = SCContentFilter(display: display, excludingWindows: exclude)
            if #available(macOS 26.0, *) {
                let shot = SCScreenshotConfiguration()
                shot.showsCursor = false
                shot.sourceRect = source
                let scale = max(screen.backingScaleFactor, 1)
                shot.width = max(Int((source.width * scale).rounded()), 1)
                shot.height = max(Int((source.height * scale).rounded()), 1)
                let output = try await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: shot)
                if let cgImage = output.sdrImage {
                    return NSImage(cgImage: cgImage, size: NSSize(width: source.width, height: source.height))
                }
            }
            let config = SCStreamConfiguration()
            config.capturesAudio = false
            if #available(macOS 15.0, *) {
                config.captureMicrophone = false
            }
            let scale = max(screen.backingScaleFactor, 1)
            config.sourceRect = source
            config.width = max(Int((source.width * scale).rounded()), 1)
            config.height = max(Int((source.height * scale).rounded()), 1)
            config.showsCursor = false
            config.captureResolution = .best
            let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            return NSImage(cgImage: cgImage, size: NSSize(width: source.width, height: source.height))
        } catch {
            NSLog("[liuli] ScreenCaptureKit: \(error)")
            return nil
        }
    }

    static func jpegBase64(_ image: NSImage, maxEdge: CGFloat = 1600, quality: CGFloat = 0.82) -> String? {
        let resized = resize(image, maxEdge: maxEdge) ?? image
        let cgImage = resized.cgImage(forProposedRect: nil, context: nil, hints: nil)
            ?? resized.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.cgImage }
        guard let cgImage else { return nil }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality])
        else { return nil }
        return data.base64EncodedString()
    }

    private static func cocoaToQuartz(_ rect: CGRect) -> CGRect {
        let primaryHeight = NSScreen.screens.first { $0.frame.origin == .zero }?.frame.height
            ?? NSScreen.main?.frame.height
            ?? 0
        return CGRect(
            x: rect.origin.x,
            y: primaryHeight - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }

    private static func screencaptureCLI(_ quartzRect: CGRect) -> NSImage? {
        let url = FileManager.default.temporaryDirectory.appending(path: "liuli-capture.png")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = [
            "-x",
            "-R",
            "\(Int(quartzRect.origin.x)),\(Int(quartzRect.origin.y)),\(Int(quartzRect.width)),\(Int(quartzRect.height))",
            url.path,
        ]
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                NSLog("[liuli] screencapture exit \(process.terminationStatus)")
                return nil
            }
            return NSImage(contentsOf: url)
        } catch {
            NSLog("[liuli] screencapture: \(error)")
            return nil
        }
    }

    private static func resize(_ image: NSImage, maxEdge: CGFloat) -> NSImage? {
        let size = image.size
        let longest = max(size.width, size.height)
        if longest <= maxEdge { return image }
        let scale = maxEdge / longest
        let newSize = NSSize(width: size.width * scale, height: size.height * scale)
        let scaled = NSImage(size: newSize)
        scaled.lockFocus()
        image.draw(in: NSRect(origin: .zero, size: newSize))
        scaled.unlockFocus()
        return scaled
    }
}
