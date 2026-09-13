import AppKit
import SwiftUI

@main
struct LiuliApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarContent()
                .environment(delegate.appState)
        } label: {
            MenuBarLeafIcon()
        }
        .menuBarExtraStyle(.menu)

        Settings {
            SettingsView()
                .environment(delegate.appState)
                .frame(minWidth: 520, idealWidth: 580, minHeight: 400)
        }
        .commands {
            CommandMenu("翻译") {
                Button("选中翻译") { delegate.appState.translateSelection() }
                Button("截图翻译") { delegate.appState.screenshotTranslate() }
                Button("截图 OCR") { delegate.appState.screenshotOCR() }
                Button("公式转 LaTeX") { delegate.appState.formulaToLatex() }
                Button("输入翻译") { delegate.appState.inputTranslate() }
                Button("静默 OCR") { delegate.appState.silentOCR() }
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let appState = AppState()
    private var overlay: OverlayPanelController?
    private var hotKeys: HotKeyManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        overlay = OverlayPanelController(state: appState)
        hotKeys = HotKeyManager(state: appState)
        Permissions.requestNotifications()
        appState.refreshPermissions()
        Task {
            await DaemonProcess.ensureStarted()
            await appState.refreshHealth()
            if !appState.selectedModelID.isEmpty {
                await appState.applyModel(appState.selectedModelID)
            }
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        appState.refreshPermissions()
        Task { await appState.refreshHealth() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        Task { await DaemonClient.shared.abort() }
        DaemonProcess.stop()
    }
}

private struct MenuBarLeafIcon: View {
    var body: some View {
        Image(nsImage: Self.image)
    }

    private static var image: NSImage {
        let loaded = NSImage(named: "MenuBarLeaf")
            ?? Bundle.main.url(forResource: "MenuBarLeaf", withExtension: "png").flatMap(NSImage.init(contentsOf:))
        guard let image = loaded else {
            return NSImage(systemSymbolName: "leaf", accessibilityDescription: "琉璃")
                ?? NSImage(size: NSSize(width: 18, height: 18))
        }
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        return image
    }
}

struct MenuBarContent: View {
    @Environment(AppState.self) private var state
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.status)
                .foregroundStyle(.secondary)
            Divider()
            Button("选中翻译") { state.translateSelection() }
            Button("截图翻译") { state.screenshotTranslate() }
            Button("截图 OCR") { state.screenshotOCR() }
            Button("公式转 LaTeX") { state.formulaToLatex() }
            Button("输入翻译") { state.inputTranslate() }
            Button("静默 OCR") { state.silentOCR() }
            Divider()
            Button("打开辅助功能设置…") { Permissions.openAccessibilitySettings() }
            Button("打开屏幕录制设置…") { Permissions.openScreenRecordingSettings() }
            Button("重启守护进程") {
                Task {
                    await DaemonProcess.restart()
                    await state.refreshHealth()
                }
            }
            Divider()
            SettingsLink {
                Text("设置…")
            }
            Button("退出琉璃") {
                NSApp.terminate(nil)
            }
        }
        .onAppear {
            state.openSettings = {
                NSApp.activate(ignoringOtherApps: true)
                openSettings()
            }
        }
    }
}
