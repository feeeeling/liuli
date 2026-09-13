import AppKit
import ApplicationServices

struct ReadingSnapshot: Equatable, Sendable {
    var appName = ""
    var windowTitle = ""
    var url = ""
    var nearbyText = ""

    var isEmpty: Bool {
        appName.isEmpty && windowTitle.isEmpty && url.isEmpty && nearbyText.isEmpty
    }

    func formatted() -> String {
        var lines: [String] = []
        if !appName.isEmpty { lines.append("应用：\(appName)") }
        if !windowTitle.isEmpty { lines.append("窗口：\(windowTitle)") }
        if !url.isEmpty { lines.append("网址：\(url)") }
        if !nearbyText.isEmpty { lines.append("附近文本：\n\(nearbyText)") }
        return lines.joined(separator: "\n")
    }
}

enum ReadingCapture {
    private static let liuliBundleID = "app.liuli.desktop"

    static func snapshot() -> ReadingSnapshot {
        guard let app = NSWorkspace.shared.frontmostApplication else { return ReadingSnapshot() }
        if app.bundleIdentifier == liuliBundleID { return ReadingSnapshot() }

        var snap = ReadingSnapshot()
        snap.appName = app.localizedName ?? ""

        let appEl = AXUIElementCreateApplication(app.processIdentifier)
        if let window = copyElement(appEl, kAXFocusedWindowAttribute as String) {
            snap.windowTitle = copyString(window, kAXTitleAttribute as String)
            snap.url = firstURL(window)
        }
        if snap.url.isEmpty {
            snap.url = firstURL(appEl)
        }
        if let focused = copyElement(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute as String) {
            if snap.url.isEmpty {
                snap.url = firstURL(focused)
            }
            let value = copyString(focused, kAXValueAttribute as String)
            snap.nearbyText = clip(value, 800)
        }
        return snap
    }

    private static func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let value
        else { return nil }
        return (value as! AXUIElement)
    }

    private static func copyString(_ element: AXUIElement, _ attribute: String) -> String {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
            return ""
        }
        if let text = value as? String { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let url = value as? URL { return url.absoluteString }
        return ""
    }

    private static func firstURL(_ element: AXUIElement, depth: Int = 0) -> String {
        for name in ["AXURL", kAXDocumentAttribute as String] {
            let raw = copyString(element, name)
            if raw.hasPrefix("http://") || raw.hasPrefix("https://") || raw.hasPrefix("file://") {
                return raw
            }
        }
        if depth >= 3 { return "" }
        var children: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
              let list = children as? [AXUIElement]
        else { return "" }
        for child in list.prefix(8) {
            let found = firstURL(child, depth: depth + 1)
            if !found.isEmpty { return found }
        }
        return ""
    }

    private static func clip(_ text: String, _ limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= limit { return trimmed }
        return String(trimmed.prefix(limit)) + "…"
    }
}
