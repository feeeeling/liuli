import AppKit

@MainActor
final class ScreenshotOverlayController {
    static let shared = ScreenshotOverlayController()

    private var panels: [NSPanel] = []
    private var views: [RegionSelectView] = []
    private var continuation: CheckedContinuation<CGRect?, Never>?
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var start: NSPoint?
    private var current: NSPoint?

    var windowNumbers: [Int] {
        panels.map(\.windowNumber)
    }

    func selectRegion() async -> CGRect? {
        if let continuation {
            self.continuation = nil
            continuation.resume(returning: nil)
        }
        dismiss()
        NSApp.activate(ignoringOtherApps: true)
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            present()
        }
    }

    func dismiss() {
        removeMonitors()
        for panel in panels { panel.orderOut(nil) }
        panels.removeAll()
        views.removeAll()
        start = nil
        current = nil
        NSCursor.arrow.set()
    }

    private func present() {
        NSCursor.crosshair.set()
        for screen in NSScreen.screens {
            let panel = NSPanel(
                contentRect: screen.frame,
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.level = .screenSaver
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.ignoresMouseEvents = false
            panel.sharingType = .none
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            panel.hidesOnDeactivate = false
            panel.acceptsMouseMovedEvents = true
            let view = RegionSelectView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.autoresizingMask = [.width, .height]
            panel.contentView = view
            panel.orderFrontRegardless()
            panel.makeKey()
            panels.append(panel)
            views.append(view)
        }

        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .keyDown]
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
            if event.type == .keyDown, event.keyCode == 53 { return nil }
            if event.type == .leftMouseDown || event.type == .leftMouseDragged || event.type == .leftMouseUp {
                return nil
            }
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
        }
    }

    private func handle(_ event: NSEvent) {
        switch event.type {
        case .keyDown where event.keyCode == 53:
            finish(nil)
        case .leftMouseDown:
            start = NSEvent.mouseLocation
            current = start
            redraw()
        case .leftMouseDragged:
            current = NSEvent.mouseLocation
            redraw()
        case .leftMouseUp:
            current = NSEvent.mouseLocation
            guard let start, let current else {
                finish(nil)
                return
            }
            let rect = NSRect(
                x: min(start.x, current.x),
                y: min(start.y, current.y),
                width: abs(current.x - start.x),
                height: abs(current.y - start.y)
            )
            finish(rect.width < 4 || rect.height < 4 ? nil : rect)
        default:
            break
        }
    }

    private func redraw() {
        for view in views {
            view.start = start
            view.current = current
            view.needsDisplay = true
        }
    }

    private func finish(_ rect: CGRect?) {
        removeMonitors()
        NSCursor.arrow.set()
        continuation?.resume(returning: rect)
        continuation = nil
    }

    private func removeMonitors() {
        if let localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        localMonitor = nil
        globalMonitor = nil
    }
}

final class RegionSelectView: NSView {
    var start: NSPoint?
    var current: NSPoint?

    override var isFlipped: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let dim = NSBezierPath(rect: bounds)
        if let start, let current, let window {
            let startLocal = convert(window.convertFromScreen(NSRect(origin: start, size: .zero)).origin, from: nil)
            let currentLocal = convert(window.convertFromScreen(NSRect(origin: current, size: .zero)).origin, from: nil)
            let rect = NSRect(
                x: min(startLocal.x, currentLocal.x),
                y: min(startLocal.y, currentLocal.y),
                width: abs(currentLocal.x - startLocal.x),
                height: abs(currentLocal.y - startLocal.y)
            )
            dim.append(NSBezierPath(rect: rect))
            dim.windingRule = .evenOdd
            NSColor.black.withAlphaComponent(0.42).setFill()
            dim.fill()
            NSColor.white.withAlphaComponent(0.9).setStroke()
            let border = NSBezierPath(roundedRect: rect, xRadius: 2, yRadius: 2)
            border.lineWidth = 1.5
            border.stroke()

            let label = "\(Int(rect.width)) × \(Int(rect.height))"
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium),
                .foregroundColor: NSColor.white,
            ]
            let size = label.size(withAttributes: attrs)
            let labelOrigin = NSPoint(x: rect.minX, y: min(rect.maxY + 6, bounds.maxY - size.height - 4))
            NSColor.black.withAlphaComponent(0.55).setFill()
            NSBezierPath(
                roundedRect: NSRect(origin: labelOrigin, size: NSSize(width: size.width + 10, height: size.height + 4)),
                xRadius: 4,
                yRadius: 4
            ).fill()
            label.draw(at: NSPoint(x: labelOrigin.x + 5, y: labelOrigin.y + 2), withAttributes: attrs)
        } else {
            NSColor.black.withAlphaComponent(0.28).setFill()
            bounds.fill()
            let hint = "拖拽选择区域 · Esc 取消"
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 15, weight: .medium),
                .foregroundColor: NSColor.white.withAlphaComponent(0.9),
            ]
            let size = hint.size(withAttributes: attrs)
            hint.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: bounds.height * 0.62), withAttributes: attrs)
        }
    }
}
