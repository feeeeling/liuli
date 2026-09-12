import AppKit
import QuartzCore
import SwiftUI

@MainActor
enum GlassChrome {
    static func wrap(_ content: NSView, cornerRadius: CGFloat = 16) -> NSView {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = cornerRadius
            glass.style = .regular
            glass.tintColor = NSColor(name: nil) { appearance in
                let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                return NSColor.black.withAlphaComponent(dark ? 0.32 : 0.10)
            }
            glass.contentView = content
            glass.focusRingType = .none
            glass.wantsLayer = true
            glass.layer?.borderWidth = 0
            glass.layer?.borderColor = CGColor.clear
            content.focusRingType = .none
            content.translatesAutoresizingMaskIntoConstraints = false
            if let container = glass.contentView ?? content.superview {
                NSLayoutConstraint.activate([
                    content.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    content.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    content.topAnchor.constraint(equalTo: container.topAnchor),
                    content.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                ])
            }
            return glass
        }
        let effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = cornerRadius
        effect.layer?.masksToBounds = true
        content.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            content.topAnchor.constraint(equalTo: effect.topAnchor),
            content.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        return effect
    }
}

@MainActor
final class OverlayPanelController {
    private let state: AppState
    private var panel: OverlayPanel?
    private var hosting: NSHostingView<OverlayRoot>?

    init(state: AppState) {
        self.state = state
        state.onShowPanel = { [weak self] in self?.show() }
        state.onHidePanel = { [weak self] in self?.hide() }
    }

    func show() {
        let panel = ensurePanel()
        let alreadyOpen = panel.isVisible && panel.alphaValue > 0.5
        if !alreadyOpen {
            position(panel)
        }
        panel.allowKey = state.needsKeyWindow
        if state.needsKeyWindow {
            panel.makeKeyAndOrderFront(nil)
        }
        if panel.alphaValue < 1 || !panel.isVisible {
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.22
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 1
            }
        } else {
            panel.orderFrontRegardless()
        }
    }

    func hide() {
        guard let panel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        } completionHandler: {
            DispatchQueue.main.async {
                panel.orderOut(nil)
            }
        }
    }

    private func ensurePanel() -> OverlayPanel {
        if let panel { return panel }
        let panel = OverlayPanel(
            contentRect: NSRect(x: 0, y: 0, width: LiuliTheme.panelWidth, height: 220),
            styleMask: [.borderless, .fullSizeContentView, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.sharingType = .none
        panel.isMovableByWindowBackground = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.minSize = NSSize(width: 320, height: 140)
        panel.maxSize = NSSize(width: 900, height: 900)

        state.onPanelResizeReset = { [weak self] in self?.resetToAutoSize() }

        let root = OverlayRoot(state: state) { [weak self] size in
            self?.applyContentSize(size)
        }
        let hosting = NSHostingView(rootView: root)
        hosting.safeAreaRegions = []
        hosting.focusRingType = .none
        updateHostingSizing()
        let chrome = GlassChrome.wrap(hosting)
        chrome.focusRingType = .none
        panel.contentView = chrome
        stripFocusChrome(chrome)
        self.panel = panel
        self.hosting = hosting
        NotificationCenter.default.addObserver(
            forName: NSWindow.willStartLiveResizeNotification,
            object: panel,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.liveResizeStarted()
            }
        }
        NotificationCenter.default.addObserver(
            forName: NSWindow.didEndLiveResizeNotification,
            object: panel,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.liveResizeEnded()
            }
        }
        return panel
    }

    private var applyingSize = false

    private func updateHostingSizing() {
        guard #available(macOS 13.0, *) else { return }
        hosting?.sizingOptions = state.panelManualSize == nil ? [.intrinsicContentSize] : []
    }

    private func resetToAutoSize() {
        state.panelLiveResizing = false
        state.panelManualSize = nil
        state.persist()
        updateHostingSizing()
    }

    private func liveResizeStarted() {
        applyingSize = true
        state.panelLiveResizing = true
        if #available(macOS 13.0, *) {
            hosting?.sizingOptions = []
        }
    }

    private func liveResizeEnded() {
        applyingSize = false
        state.panelLiveResizing = false
        if let panel {
            state.persistPanelSize(panel.frame.size)
        }
        updateHostingSizing()
    }

    private func applyContentSize(_ size: CGSize) {
        guard state.panelManualSize == nil else { return }
        guard let panel, size.width > 0, size.height > 0 else { return }
        let screen = panel.screen?.visibleFrame
            ?? NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.visibleFrame, false) }?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let width = LiuliTheme.panelWidth
        let height = min(max(size.height, 120), screen.height - 24)
        var frame = panel.frame
        let top = frame.height > 40 ? frame.maxY : NSEvent.mouseLocation.y + 12
        frame.size = NSSize(width: width, height: height)
        frame.origin.x = min(max(frame.origin.x, screen.minX + 12), screen.maxX - width - 12)
        frame.origin.y = top - height
        if frame.minY < screen.minY { frame.origin.y = screen.minY }
        if frame.maxY > screen.maxY { frame.origin.y = screen.maxY - height }
        if abs(frame.height - panel.frame.height) > 1 || abs(frame.width - panel.frame.width) > 1
            || abs(frame.origin.x - panel.frame.origin.x) > 1
        {
            applyingSize = true
            panel.setFrame(frame, display: true)
            applyingSize = false
        }
    }

    private func position(_ panel: NSPanel) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.visibleFrame, false) } ?? NSScreen.main
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        var frame = panel.frame
        if let manual = state.panelManualSize {
            frame.size = manual
        } else if frame.width < 100 {
            frame.size = NSSize(width: LiuliTheme.panelWidth, height: 180)
        }
        var origin = NSPoint(x: mouse.x + 18, y: mouse.y - frame.height - 12)
        origin.x = min(max(origin.x, visible.minX + 12), visible.maxX - frame.width - 12)
        origin.y = min(max(origin.y, visible.minY + 12), visible.maxY - frame.height - 12)
        panel.setFrameOrigin(origin)
    }
}

private struct EditorChromeStripper: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async { stripFocusChrome(view) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { stripFocusChrome(nsView) }
    }
}

private func stripFocusChrome(_ view: NSView) {
    view.focusRingType = .none
    if let scroll = view as? NSScrollView {
        scroll.borderType = .noBorder
        scroll.focusRingType = .none
        scroll.drawsBackground = false
        scroll.backgroundColor = .clear
    }
    if let text = view as? NSTextView {
        text.focusRingType = .none
        text.drawsBackground = false
        text.enclosingScrollView?.borderType = .noBorder
        text.enclosingScrollView?.drawsBackground = false
        text.enclosingScrollView?.focusRingType = .none
    }
    view.wantsLayer = true
    view.layer?.borderWidth = 0
    view.layer?.borderColor = CGColor.clear
    for sub in view.subviews {
        stripFocusChrome(sub)
    }
}

final class OverlayPanel: NSPanel {
    var allowKey = false

    override var canBecomeKey: Bool { allowKey }
    override var canBecomeMain: Bool { false }
    override var acceptsFirstResponder: Bool { allowKey }

    override func becomeKey() {
        super.becomeKey()
        if let contentView {
            stripFocusChrome(contentView)
            DispatchQueue.main.async {
                stripFocusChrome(contentView)
            }
        }
    }
}

private struct PanelSizeKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        let next = nextValue()
        if next.width * next.height > value.width * value.height {
            value = next
        }
    }
}

struct OverlayRoot: View {
    @Bindable var state: AppState
    var onSize: (CGSize) -> Void

    var body: some View {
        OverlayView()
            .environment(state)
            .onPreferenceChange(PanelSizeKey.self, perform: onSize)
    }
}

struct OverlayView: View {
    @Environment(AppState.self) private var state

    private var fillsWindow: Bool {
        state.panelManualSize != nil || state.panelLiveResizing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LiuliTheme.sectionSpacing) {
            header
            if let image = state.screenshot, state.mode != .ocr, state.mode != .ocrTranslate {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxHeight: 72)
                    .clipShape(RoundedRectangle(cornerRadius: LiuliTheme.cardRadius, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: LiuliTheme.cardRadius, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                    )
            }
            if showsSource {
                sourceBlock
                Divider().opacity(0.12)
            }
            resultBlock
            if let error = state.lastError, !error.isEmpty {
                Text(error)
                    .font(LiuliTheme.captionFont)
                    .foregroundStyle(.red.opacity(0.9))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            footer
        }
        .padding(LiuliTheme.panelPadding)
        .frame(
            minWidth: 320,
            idealWidth: LiuliTheme.panelWidth,
            maxWidth: fillsWindow ? .infinity : LiuliTheme.panelWidth,
            minHeight: 140,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .frame(
            width: fillsWindow ? nil : LiuliTheme.panelWidth,
            alignment: .topLeading
        )
        .fixedSize(horizontal: !fillsWindow, vertical: !fillsWindow)
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: PanelSizeKey.self, value: geo.size)
            }
        )
        .task {
            await state.refreshCatalog()
        }
        .focusable(false)
        .focusEffectDisabled()
        .ignoresSafeArea()
    }

    private var header: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            IconButton(
                systemName: state.isPinned ? "pin.fill" : "pin",
                help: "钉住面板",
                emphasized: state.isPinned
            ) {
                state.isPinned.toggle()
            }
            IconButton(systemName: "xmark", help: "关闭") {
                state.isPinned = false
                state.hideIfAllowed()
            }
        }
        .frame(height: 22)
    }

    private func sectionTitle(
        _ title: String,
        copy: @escaping () -> Void,
        enabled: Bool,
        retry: (() -> Void)? = nil
    ) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(LiuliTheme.captionFont.weight(.semibold))
                .foregroundStyle(Color.secondary)
            Button(action: copy) {
                Image(systemName: "doc.on.doc")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(enabled ? Color.secondary : Color.secondary.opacity(0.35))
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .help("拷贝\(title)")
            if let retry {
                Button(action: retry) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.secondary)
                }
                .buttonStyle(.plain)
                .disabled(state.isStreaming || (state.sourceText.isEmpty && state.screenshot == nil))
                .help("重试")
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var sourceBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle("原文", copy: state.copySource, enabled: !state.sourceText.isEmpty)
            if state.needsKeyWindow {
                TextEditor(text: Bindable(state).sourceText)
                    .font(LiuliTheme.bodyFont)
                    .scrollContentBackground(.hidden)
                    .scrollIndicators(.never)
                    .focusEffectDisabled()
                    .background(EditorChromeStripper())
                    .frame(minHeight: 48, maxHeight: 96)
            } else if !state.sourceText.isEmpty {
                GlassScrollView(minHeight: 24, maxHeight: 96) {
                    Text(state.sourceText)
                        .font(LiuliTheme.bodyFont)
                        .foregroundStyle(Color.primary.opacity(0.82))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button("拷贝原文") { state.copySource() }
                        }
                }
            }
        }
    }

    @ViewBuilder
    private var resultBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle(
                state.mode == .ocr ? "识别" : (state.mode == .latex ? "LaTeX" : "译文"),
                copy: state.copyResult,
                enabled: !displayResult.isEmpty,
                retry: state.retry
            )
            ScrollViewReader { proxy in
                GlassScrollView(minHeight: 36, maxHeight: resultMaxHeight) {
                    Text(streamingResult)
                        .font(state.mode == .ocr ? LiuliTheme.bodyFont : (state.resultText.isEmpty ? LiuliTheme.bodyFont : LiuliTheme.resultFont))
                        .foregroundStyle(displayResult.isEmpty && !state.isStreaming ? Color.secondary : Color.primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button("拷贝") { state.copyResult() }
                                .disabled(displayResult.isEmpty)
                        }
                        .id("result-tail")
                }
                .onChange(of: state.resultText) { _, _ in
                    guard state.isStreaming else { return }
                    proxy.scrollTo("result-tail", anchor: .bottom)
                }
            }
            .frame(maxHeight: state.panelManualSize == nil ? nil : .infinity)
            if state.mode == .latex, !state.resultText.isEmpty, !state.isStreaming {
                GlassScrollView(minHeight: 72, maxHeight: 160) {
                    LatexPreview(latex: state.resultText)
                        .frame(maxWidth: .infinity, minHeight: 72)
                }
            }
        }
    }

    private var showsSource: Bool {
        state.mode != .ocr && (state.needsKeyWindow || !state.sourceText.isEmpty)
    }

    private var showsTargetLang: Bool {
        state.mode == .translate || state.mode == .ocrTranslate
    }

    private var showsResultLabel: Bool {
        state.mode != .ocr
    }

    private var displayResult: String {
        if state.mode == .ocr {
            return state.resultText.isEmpty ? state.sourceText : state.resultText
        }
        return state.resultText
    }

    private var streamingResult: String {
        let body = displayResult
        if body.isEmpty {
            return state.isStreaming ? "▍" : "…"
        }
        return state.isStreaming ? body + "▍" : body
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Spacer()
            if state.isStreaming {
                ProgressView().controlSize(.small)
            }
            if showsTargetLang {
                languageMenu
            }
            modelMenu
        }
        .buttonStyle(.borderless)
        .font(.system(size: 12))
        .controlSize(.small)
    }

    private var resultMaxHeight: CGFloat {
        state.panelManualSize == nil ? 260 : .infinity
    }

    private var languageMenu: some View {
        Menu {
            ForEach(TargetLang.allCases) { lang in
                Button {
                    state.targetLang = lang
                    state.persist()
                } label: {
                    if lang == state.targetLang {
                        Label(lang.title, systemImage: "checkmark")
                    } else {
                        Text(lang.title)
                    }
                }
            }
        } label: {
            Text(state.targetLang.title)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("目标语言")
    }

    @ViewBuilder
    private var modelMenu: some View {
        if state.models.isEmpty {
            Button(state.status) {
                state.openSettings?()
            }
            .buttonStyle(.plain)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        } else {
            Menu {
                ForEach(modelGroups, id: \.provider) { group in
                    Section(group.provider) {
                        ForEach(group.models, id: \.qualifiedID) { model in
                            Button {
                                Task { await state.applyModel(model.qualifiedID) }
                            } label: {
                                if isSelected(model) {
                                    Label(model.name + (model.vision ? " · 视觉" : ""), systemImage: "checkmark")
                                } else {
                                    Text(model.name + (model.vision ? " · 视觉" : ""))
                                }
                            }
                        }
                    }
                }
                Divider()
                Button("设置…") {
                    state.openSettings?()
                }
            } label: {
                Text(footerModelLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: 180, alignment: .trailing)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .disabled(state.isStreaming)
            .help("切换模型")
        }
    }

    private var footerModelLabel: String {
        if !state.modelName.isEmpty { return state.modelName }
        return state.status
    }

    private var modelGroups: [(provider: String, models: [ModelInfo])] {
        let order = Dictionary(uniqueKeysWithValues: state.models.enumerated().map { ($0.element.qualifiedID, $0.offset) })
        let grouped = Dictionary(grouping: state.models, by: \.provider)
        return grouped.keys.sorted().map { provider in
            let models = (grouped[provider] ?? []).sorted {
                (order[$0.qualifiedID] ?? 0) < (order[$1.qualifiedID] ?? 0)
            }
            return (provider, models)
        }
    }

    private func isSelected(_ model: ModelInfo) -> Bool {
        model.qualifiedID == state.selectedModelID || model.qualifiedID == state.modelName
    }
}

private struct GlassScrollView<Content: View>: View {
    var minHeight: CGFloat
    var maxHeight: CGFloat
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            content()
        }
        .scrollIndicators(.never)
        .frame(minHeight: minHeight, maxHeight: maxHeight)
    }
}

private struct IconButton: View {
    var systemName: String
    var help: String
    var emphasized: Bool = false
    var action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(emphasized ? Color.accentColor : Color.primary.opacity(0.7))
                .frame(width: 22, height: 22)
                .background(
                    Circle().fill(hovered ? Color.primary.opacity(0.08) : .clear)
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.easeOut(duration: LiuliTheme.hoverDuration)) {
                hovered = hovering
            }
        }
        .help(help)
    }
}
