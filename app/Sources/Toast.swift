import AppKit
import SwiftUI

@MainActor
enum Toast {
    private static var panel: NSPanel?

    static func show(_ text: String) {
        hide()
        let hosting = NSHostingView(rootView: ToastView(text: text))
        hosting.frame = NSRect(x: 0, y: 0, width: 280, height: 48)
        let panel = OverlayPanel(
            contentRect: hosting.frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.contentView = GlassChrome.wrap(hosting)
        if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(
                x: screen.midX - 140,
                y: screen.minY + 80
            ))
        }
        panel.orderFrontRegardless()
        self.panel = panel
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            hide()
        }
    }

    static func hide() {
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct ToastView: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
    }
}
