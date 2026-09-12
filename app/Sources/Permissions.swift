import ApplicationServices
import AppKit
import CoreGraphics
import UserNotifications

enum Permissions {
    nonisolated(unsafe) private static var didPromptAccessibility = false

    static var accessibilityTrusted: Bool {
        AXIsProcessTrusted()
    }

    static func promptAccessibility() {
        if AXIsProcessTrusted() { return }
        guard !didPromptAccessibility else { return }
        didPromptAccessibility = true
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    static var screenRecordingTrusted: Bool {
        CGPreflightScreenCaptureAccess()
    }

    static var isBundledApp: Bool {
        Bundle.main.bundleIdentifier == "app.liuli.desktop"
    }

    static func requestNotifications() {
        guard isBundledApp else { return }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    static func openAccessibilitySettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    static func openScreenRecordingSettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    }

    private static func open(_ spec: String) {
        if let url = URL(string: spec) {
            NSWorkspace.shared.open(url)
        }
    }
}
