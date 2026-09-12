import ServiceManagement
import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("通用", systemImage: "gear") }
            ShortcutsSettingsTab()
                .tabItem { Label("快捷键", systemImage: "keyboard") }
            ModelsSettingsTab()
                .tabItem { Label("模型", systemImage: "cpu") }
            AccountsSettingsTab()
                .tabItem { Label("账号", systemImage: "person.crop.circle") }
            PrivacySettingsTab()
                .tabItem { Label("权限", systemImage: "lock.shield") }
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 380, idealHeight: 460)
    }
}

private struct GeneralSettingsTab: View {
    @Environment(AppState.self) private var state
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Form {
            Section("翻译") {
                Picker("目标语言", selection: Bindable(state).targetLang) {
                    ForEach(TargetLang.allCases) { lang in
                        Text(lang.title).tag(lang)
                    }
                }
                .onChange(of: state.targetLang) { _, _ in
                    state.persist()
                }
                Toggle("静默 OCR 用模型精修", isOn: Bindable(state).enhanceSilentOCR)
                    .onChange(of: state.enhanceSilentOCR) { _, _ in
                        state.persist()
                    }
            }
            Section("开机自启") {
                Toggle("登录时启动琉璃", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in
                        do {
                            if enabled {
                                try SMAppService.mainApp.register()
                            } else {
                                try SMAppService.mainApp.unregister()
                            }
                        } catch {
                            launchAtLogin = SMAppService.mainApp.status == .enabled
                        }
                    }
                if SMAppService.mainApp.status == .notFound {
                    Text("把 琉璃.app 放到「应用程序」后再开启开机自启。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding(8)
    }
}

private struct ShortcutsSettingsTab: View {
    var body: some View {
        Form {
            Section("快捷键") {
                ForEach(HotKeyAction.allCases) { action in
                    HotKeyRecorderRow(action: action)
                }
                LabeledContent("关闭面板") {
                    Text("Esc").foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding(8)
    }
}

private struct ModelsSettingsTab: View {
    @Environment(AppState.self) private var state

    var body: some View {
        Form {
            Section("当前模型") {
                if state.models.isEmpty {
                    Text("先到「账号」登录一个供应商。")
                        .foregroundStyle(.secondary)
                } else {
                    Picker("模型", selection: Bindable(state).selectedModelID) {
                        ForEach(state.models, id: \.qualifiedID) { model in
                            Text("\(model.provider) / \(model.name)\(model.vision ? " · 视觉" : "")")
                                .tag(model.qualifiedID)
                        }
                    }
                    .onChange(of: state.selectedModelID) { _, id in
                        Task { await state.applyModel(id) }
                    }
                }
                LabeledContent("状态") {
                    Text(state.status)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .formStyle(.grouped)
        .padding(8)
        .task { await state.refreshHealth() }
    }
}

private struct AccountsSettingsTab: View {
    @Environment(AppState.self) private var state
    @State private var loginProviderID: String?
    @State private var providerQuery = ""
    @State private var showAllProviders = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if state.isLoggingIn || !state.loginMessage.isEmpty || state.loginPrompt != nil {
                loginBanner
            } else {
                Text("ChatGPT 订阅请登录 OpenAI Codex。API Key 请登录 OpenAI。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                TextField("搜索供应商", text: $providerQuery)
                    .textFieldStyle(.roundedBorder)
                Toggle("全部", isOn: $showAllProviders)
                    .toggleStyle(.checkbox)
                    .fixedSize()
            }

            List(visibleProviders) { provider in
                providerRow(provider)
                    .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
            }
            .listStyle(.inset)
            .frame(maxHeight: .infinity)
        }
        .padding(16)
        .task { await state.refreshCatalog() }
    }

    @ViewBuilder
    private var loginBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(state.loginMessage.isEmpty ? "正在登录…" : state.loginMessage)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            if !state.loginURL.isEmpty, let url = URL(string: state.loginURL) {
                HStack {
                    Button("打开登录页") {
                        NSWorkspace.shared.open(url)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    Text(state.loginURL)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            if let prompt = state.loginPrompt {
                promptRow(prompt)
            }
            if state.isLoggingIn {
                Button("取消登录", action: state.cancelLogin)
                    .controlSize(.small)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func providerRow(_ provider: ProviderInfo) -> some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                    .lineLimit(1)
                Text(provider.configured ? (provider.source ?? "已登录") : "未登录")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if provider.configured {
                Button("重新登录") { startLogin(provider) }
                    .controlSize(.small)
                Button("退出") {
                    Task { await state.logout(providerId: provider.id) }
                }
                .controlSize(.small)
            } else {
                if provider.authTypes.contains(.apiKey) {
                    Button("API Key") {
                        loginProviderID = provider.id
                    }
                    .controlSize(.small)
                }
                if provider.authTypes.contains(.oauth) {
                    Button(shortLoginLabel(provider)) {
                        state.login(providerId: provider.id, type: .oauth)
                    }
                    .controlSize(.small)
                }
            }
        }
        if loginProviderID == provider.id {
            SecureField("API Key", text: Bindable(state).apiKeyDraft)
            HStack {
                Button("登录") {
                    state.login(providerId: provider.id, type: .apiKey, apiKey: state.apiKeyDraft)
                    loginProviderID = nil
                }
                .disabled(state.apiKeyDraft.isEmpty)
                Button("取消") {
                    loginProviderID = nil
                    state.apiKeyDraft = ""
                }
            }
        }
    }

    @ViewBuilder
    private func promptRow(_ prompt: LoginPrompt) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(prompt.message)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            if prompt.type == "select" {
                ForEach(prompt.options) { option in
                    Button(option.label) {
                        state.answerLogin(option.id)
                    }
                    .controlSize(.small)
                }
            } else if prompt.type == "secret" {
                SecureField(prompt.placeholder ?? "", text: Bindable(state).apiKeyDraft)
                Button("继续") { state.answerLogin(state.apiKeyDraft) }
                    .controlSize(.small)
            } else {
                TextField(prompt.placeholder ?? "授权码或回调 URL", text: Bindable(state).apiKeyDraft)
                Button("继续") { state.answerLogin(state.apiKeyDraft) }
                    .controlSize(.small)
            }
        }
    }

    private func shortLoginLabel(_ provider: ProviderInfo) -> String {
        if provider.id == "openai-codex" { return "浏览器登录" }
        return provider.loginLabel ?? "浏览器登录"
    }

    private var visibleProviders: [ProviderInfo] {
        let popular = [
            "openai-codex", "openai", "anthropic", "xai", "google", "openrouter", "deepseek",
        ]
        let query = providerQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = query.isEmpty
            ? state.providers
            : state.providers.filter {
                $0.name.lowercased().contains(query) || $0.id.lowercased().contains(query)
            }
        let narrowed = (showAllProviders || !query.isEmpty)
            ? filtered
            : filtered.filter { $0.configured || popular.contains($0.id) }
        return narrowed.sorted { a, b in
            if a.configured != b.configured { return a.configured }
            let ia = popular.firstIndex(of: a.id) ?? 99
            let ib = popular.firstIndex(of: b.id) ?? 99
            if ia != ib { return ia < ib }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    private func startLogin(_ provider: ProviderInfo) {
        if provider.authTypes.contains(.oauth) {
            state.login(providerId: provider.id, type: .oauth)
            return
        }
        loginProviderID = provider.id
    }
}

private struct PrivacySettingsTab: View {
    @Environment(AppState.self) private var state

    var body: some View {
        Form {
            Section("权限") {
                LabeledContent("辅助功能") {
                    Text(state.accessibilityTrusted ? "已授权" : "未授权")
                        .foregroundStyle(state.accessibilityTrusted ? .green : .orange)
                }
                Button("打开辅助功能设置…", action: Permissions.openAccessibilitySettings)
                LabeledContent("屏幕录制") {
                    Text(state.screenRecordingTrusted ? "已授权" : "未授权（授权后需重启）")
                        .foregroundStyle(state.screenRecordingTrusted ? .green : .orange)
                }
                Button("打开屏幕录制设置…", action: Permissions.openScreenRecordingSettings)
                Button("重启琉璃使权限生效") {
                    state.relaunch()
                }
            }
            Section("说明") {
                Text("请授权「琉璃」，路径为 dist/Liuli.app。屏幕录制打开后必须重启才会生效。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section("历史") {
                Button("清空翻译历史") {
                    HistoryStore().clear()
                    state.history = []
                }
            }
        }
        .formStyle(.grouped)
        .padding(8)
        .onAppear { state.refreshPermissions() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            state.refreshPermissions()
        }
    }
}
