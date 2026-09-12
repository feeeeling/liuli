import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    var mode: TaskMode = .translate
    var targetLang: TargetLang = .zh
    var sourceText = ""
    var resultText = ""
    var isStreaming = false
    var isPinned = false
    var isPanelVisible = false
    var needsKeyWindow = false
    var screenshot: NSImage?
    var status = "启动中…"
    var lastError: String?
    var modelName = ""
    var daemonConnected = false
    var enhanceSilentOCR = true
    var providers: [ProviderInfo] = []
    var models: [ModelInfo] = []
    var selectedModelID = ""
    var history: [HistoryEntry] = []
    var loginPrompt: LoginPrompt?
    var loginMessage = ""
    var isLoggingIn = false
    var apiKeyDraft = ""
    var loginURL = ""
    var isSelectingRegion = false
    var accessibilityTrusted = false
    var screenRecordingTrusted = false
    var panelManualSize: CGSize?
    var panelLiveResizing = false

    var onShowPanel: (() -> Void)?
    var onHidePanel: (() -> Void)?
    var openSettings: (() -> Void)?
    var onHotKeysChanged: (() -> Void)?
    var onPanelResizeReset: (() -> Void)?
    var chords: [HotKeyAction: KeyChord] = [:]

    private var streamTask: Task<Void, Never>?
    private var loginTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard
    private let historyStore = HistoryStore()

    init() {
        if let stored = defaults.string(forKey: "liuli.targetLang"),
           let lang = TargetLang(rawValue: stored)
        {
            targetLang = lang
        }
        selectedModelID = defaults.string(forKey: "liuli.model") ?? ""
        enhanceSilentOCR = defaults.object(forKey: "liuli.enhanceSilentOCR") as? Bool ?? true
        history = historyStore.load()
        let storedW = defaults.double(forKey: "liuli.panelW")
        let storedH = defaults.double(forKey: "liuli.panelH")
        if storedW >= 320, storedH >= 140 {
            panelManualSize = CGSize(width: storedW, height: storedH)
        }
        refreshPermissions()
        for action in HotKeyAction.allCases {
            if let data = defaults.data(forKey: "liuli.hotkey.\(action.rawValue)"),
               let chord = try? JSONDecoder().decode(KeyChord.self, from: data)
            {
                chords[action] = chord
            } else {
                chords[action] = action.defaultChord
            }
        }
    }

    func chord(for action: HotKeyAction) -> KeyChord {
        chords[action] ?? action.defaultChord
    }

    func setChord(_ chord: KeyChord, for action: HotKeyAction) {
        chords[action] = chord
        if let data = try? JSONEncoder().encode(chord) {
            defaults.set(data, forKey: "liuli.hotkey.\(action.rawValue)")
        }
        onHotKeysChanged?()
    }

    func refreshPermissions() {
        accessibilityTrusted = Permissions.accessibilityTrusted
        screenRecordingTrusted = Permissions.screenRecordingTrusted
    }

    func relaunch() {
        let path = Bundle.main.bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        task.arguments = ["-n", path]
        try? task.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            NSApp.terminate(nil)
        }
    }

    func persist() {
        defaults.set(targetLang.rawValue, forKey: "liuli.targetLang")
        defaults.set(selectedModelID, forKey: "liuli.model")
        defaults.set(enhanceSilentOCR, forKey: "liuli.enhanceSilentOCR")
        if let size = panelManualSize {
            defaults.set(size.width, forKey: "liuli.panelW")
            defaults.set(size.height, forKey: "liuli.panelH")
        } else {
            defaults.removeObject(forKey: "liuli.panelW")
            defaults.removeObject(forKey: "liuli.panelH")
        }
    }

    func persistPanelSize(_ size: CGSize) {
        panelManualSize = size
        persist()
    }

    func resetPanelSize() {
        panelManualSize = nil
        persist()
        onPanelResizeReset?()
    }

    func translateSelection() {
        Task { await translateSelectionAsync() }
    }

    func screenshotTranslate() {
        Task { await captureAndRun(mode: .ocrTranslate) }
    }

    func screenshotOCR() {
        Task { await captureAndRun(mode: .ocr) }
    }

    func formulaToLatex() {
        Task { await captureAndRun(mode: .latex) }
    }

    func inputTranslate() {
        mode = .translate
        screenshot = nil
        sourceText = ""
        resultText = ""
        lastError = nil
        needsKeyWindow = true
        showPanel()
    }

    func silentOCR() {
        Task { await silentOCRAsync() }
    }

    func retry() {
        Task { await runCurrentTask() }
    }

    func copyResult() {
        let text = mode == .ocr && resultText.isEmpty ? sourceText : resultText
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func copySource() {
        guard !sourceText.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(sourceText, forType: .string)
    }

    func hideIfAllowed() {
        guard !isPinned, !isSelectingRegion else { return }
        isPanelVisible = false
        needsKeyWindow = false
        onHidePanel?()
    }

    func showPanel() {
        isPanelVisible = true
        onShowPanel?()
    }

    func restore(_ entry: HistoryEntry) {
        mode = entry.mode
        sourceText = entry.source
        resultText = entry.result
        lastError = nil
        screenshot = nil
        showPanel()
    }

    func refreshHealth() async {
        do {
            let health = try await DaemonClient.shared.health()
            daemonConnected = true
            modelName = [health.provider, health.model].compactMap { $0 }.joined(separator: "/")
            if health.ok {
                status = "已连接 \(modelName)"
                lastError = nil
            } else {
                status = health.error ?? "守护进程未就绪"
                lastError = health.error
            }
        } catch {
            daemonConnected = false
            status = "守护进程未连接"
            lastError = error.localizedDescription
        }
        await refreshCatalog()
    }

    func refreshCatalog() async {
        providers = (try? await DaemonClient.shared.providers()) ?? providers
        if let catalog = try? await DaemonClient.shared.models() {
            models = catalog.models
            if selectedModelID.isEmpty, let current = catalog.current {
                selectedModelID = current
            }
        }
        if !selectedModelID.isEmpty {
            persist()
        }
    }

    func applyModel(_ id: String) async {
        selectedModelID = id
        persist()
        do {
            let health = try await DaemonClient.shared.setModel(id)
            modelName = [health.provider, health.model].compactMap { $0 }.joined(separator: "/")
            status = health.ok ? "已连接 \(modelName)" : (health.error ?? status)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func login(providerId: String, type: AuthKind, apiKey: String? = nil) {
        loginTask?.cancel()
        isLoggingIn = true
        loginMessage = "正在登录…"
        loginURL = ""
        loginPrompt = nil
        loginTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await DaemonClient.shared.login(
                    providerId: providerId,
                    type: type,
                    apiKey: apiKey
                ) { event in
                    await self.handleLoginEvent(event)
                }
                self.isLoggingIn = false
                self.loginPrompt = nil
                self.loginURL = ""
                self.loginMessage = "已登录"
                self.apiKeyDraft = ""
                await self.refreshHealth()
            } catch is CancellationError {
                self.isLoggingIn = false
            } catch {
                self.isLoggingIn = false
                self.loginMessage = error.localizedDescription
            }
        }
    }

    func answerLogin(_ value: String) {
        guard let prompt = loginPrompt else { return }
        loginPrompt = nil
        Task {
            try? await DaemonClient.shared.answerPrompt(id: prompt.id, value: value)
        }
    }

    func cancelLogin() {
        loginTask?.cancel()
        isLoggingIn = false
        loginPrompt = nil
        loginURL = ""
        Task { await DaemonClient.shared.cancelLogin() }
    }

    func logout(providerId: String) async {
        do {
            try await DaemonClient.shared.logout(providerId: providerId)
            await refreshHealth()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func openBrowser(_ url: URL) {
        NSApp.activate(ignoringOtherApps: true)
        let opened = NSWorkspace.shared.open(url)
        if !opened {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            task.arguments = [url.absoluteString]
            try? task.run()
        }
    }

    private func handleLoginEvent(_ event: LoginSSEEvent) {
        switch event.event {
        case "auth_url", "open-url":
            if let urlString = event.url, let url = URL(string: urlString) {
                loginURL = urlString
                loginMessage = event.instructions ?? "请在浏览器中完成登录"
                openBrowser(url)
            }
        case "device_code":
            loginMessage = "设备码 \(event.userCode ?? "")"
            if let uri = event.verificationUri, let url = URL(string: uri) {
                loginURL = uri
                openBrowser(url)
            }
        case "prompt":
            loginPrompt = event.prompt
        case "progress", "info":
            loginMessage = event.message ?? loginMessage
        default:
            break
        }
    }

    private func translateSelectionAsync() async {
        mode = .translate
        screenshot = nil
        needsKeyWindow = false
        let text = await SelectionCapture.readSelectedText()
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            sourceText = ""
            resultText = ""
            lastError = Permissions.accessibilityTrusted
                ? "没有选中文字。"
                : "没有选中文字。请先选中文本，或授予辅助功能权限。"
            showPanel()
            return
        }
        sourceText = text
        resultText = ""
        lastError = nil
        showPanel()
        await runCurrentTask()
    }

    private func captureAndRun(mode: TaskMode) async {
        self.mode = mode
        needsKeyWindow = false
        guard let image = await captureRegion() else { return }
        screenshot = image
        sourceText = mode == .latex ? "" : VisionOCR.recognize(image)
        resultText = ""
        lastError = nil
        showPanel()
        await runCurrentTask()
    }

    private func silentOCRAsync() async {
        needsKeyWindow = false
        hideIfAllowed()
        guard let image = await captureRegion(showErrorPanel: false) else { return }
        let draft = VisionOCR.recognize(image)
        let changeCount = NSPasteboard.general.changeCount
        if !draft.isEmpty {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(draft, forType: .string)
            Toast.show("已复制（本地 OCR）")
        }
        guard enhanceSilentOCR else { return }
        screenshot = image
        sourceText = draft
        mode = .ocr
        await runCurrentTask(recordHistory: true)
        if !resultText.isEmpty, NSPasteboard.general.changeCount == changeCount + 1 || NSPasteboard.general.string(forType: .string) == draft {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(resultText, forType: .string)
            Toast.show("已精修并复制")
        }
        hideIfAllowed()
    }

    private func captureRegion(showErrorPanel: Bool = true) async -> NSImage? {
        hideIfAllowed()
        isPinned = false
        isSelectingRegion = true
        defer {
            isSelectingRegion = false
            ScreenshotOverlayController.shared.dismiss()
        }
        try? await Task.sleep(for: .milliseconds(150))
        guard let rect = await ScreenshotOverlayController.shared.selectRegion() else { return nil }
        let windowNumbers = ScreenshotOverlayController.shared.windowNumbers
        if let image = await ScreenCapture.image(rect: rect, excludingWindowNumbers: windowNumbers) {
            return image
        }
        ScreenshotOverlayController.shared.dismiss()
        try? await Task.sleep(for: .milliseconds(80))
        if let image = await ScreenCapture.image(rect: rect) {
            return image
        }
        lastError = screenRecordingTrusted
            ? "截图失败。可到系统设置 → 隐私与安全性 → 屏幕录制里确认已打开琉璃，然后重试。"
            : "截图失败：当前进程还没有屏幕录制权限。请在系统设置里打开琉璃，然后到设置页点「重启琉璃使权限生效」。"
        if showErrorPanel { showPanel() }
        return nil
    }

    private func runCurrentTask(recordHistory: Bool = true) async {
        streamTask?.cancel()
        await DaemonClient.shared.abort()
        let request = DaemonClient.TaskRequest(
            id: UUID().uuidString,
            mode: mode,
            text: sourceText.isEmpty ? nil : sourceText,
            imageBase64: screenshot.flatMap { ScreenCapture.jpegBase64($0) },
            mimeType: screenshot == nil ? nil : "image/jpeg",
            targetLang: targetLang.rawValue
        )
        guard request.text != nil || request.imageBase64 != nil else {
            lastError = "没有可处理的内容"
            return
        }

        isStreaming = true
        resultText = ""
        lastError = nil
        status = "生成中…"

        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await DaemonClient.shared.stream(request) { delta in
                    await MainActor.run {
                        self.resultText += delta
                    }
                }
                if self.mode == .ocrTranslate {
                    let split = OcrTranslateSplit.parse(self.resultText)
                    self.sourceText = split.source.isEmpty ? self.sourceText : split.source
                    self.resultText = split.translation.isEmpty ? split.raw : split.translation
                }
                if self.mode == .latex, !self.resultText.isEmpty {
                    self.resultText = LatexSanitize.forCopy(self.resultText)
                }
                self.isStreaming = false
                self.status = self.daemonConnected ? "已连接 \(self.modelName)" : "完成"
                if recordHistory, !self.resultText.isEmpty {
                    let entry = HistoryEntry(
                        id: UUID().uuidString,
                        timestamp: Date(),
                        mode: self.mode,
                        source: self.sourceText,
                        result: self.resultText,
                        targetLang: self.targetLang.rawValue
                    )
                    let duplicate = self.history.first.map {
                        $0.mode == entry.mode && $0.source == entry.source && $0.result == entry.result
                    } ?? false
                    if !duplicate {
                        self.historyStore.append(entry)
                        self.history.insert(entry, at: 0)
                        if self.history.count > 40 {
                            self.history = Array(self.history.prefix(40))
                        }
                    }
                }
            } catch is CancellationError {
                self.isStreaming = false
            } catch {
                self.isStreaming = false
                self.lastError = error.localizedDescription
                self.status = "出错"
            }
        }
        await streamTask?.value
    }
}
