import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class OverlayPanelController {
    private let state: AppState
    private var panel: OverlayPanel?
    private var hosting: NSHostingView<OverlayRoot>?

    init(state: AppState) {
        self.state = state
        state.onShowPanel = { [weak self] in self?.show() }
        state.onHidePanel = { [weak self] in self?.hide() }
        state.onFollowUpOpen = { [weak self] in
            DispatchQueue.main.async { self?.ensureComposerVisible() }
        }
    }

    func show() {
        let panel = ensurePanel()
        let alreadyOpen = panel.isVisible && panel.alphaValue > 0.5
        if !alreadyOpen {
            position(panel)
        }
        panel.allowKey = state.needsKeyWindow
        if state.needsKeyWindow {
            NSApp.activate(ignoringOtherApps: true)
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
        panel.minSize = NSSize(width: 320, height: 140)
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
        panel.minSize = NSSize(width: 320, height: state.followUpOpen ? 240 : 140)
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
        guard !state.panelLiveResizing else { return }
        guard size.width > 0, size.height > 0 else { return }
        if state.panelManualSize != nil {
            if state.followUpOpen {
                resizePanel(to: size.height, growOnly: true)
            }
            return
        }
        resizePanel(to: size.height, growOnly: false)
    }

    private func ensureComposerVisible() {
        guard state.followUpOpen, let panel else { return }
        panel.minSize = NSSize(width: 320, height: 240)
        let needed = max(measuredComposerHeight(), panel.frame.height)
        resizePanel(to: needed, growOnly: true)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.state.followUpOpen else { return }
            self.resizePanel(to: max(self.measuredComposerHeight(), 240), growOnly: true)
        }
    }

    private func measuredComposerHeight() -> CGFloat {
        guard let hosting else { return 280 }
        if #available(macOS 13.0, *) {
            let saved = hosting.sizingOptions
            hosting.sizingOptions = [.intrinsicContentSize]
            hosting.invalidateIntrinsicContentSize()
            let height = hosting.fittingSize.height
            hosting.sizingOptions = saved
            return height > 0 ? height : 280
        }
        let height = hosting.fittingSize.height
        return height > 0 ? height : 280
    }

    private func resizePanel(to rawHeight: CGFloat, growOnly: Bool) {
        guard let panel, !applyingSize else { return }
        let screen = panel.screen?.visibleFrame
            ?? NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.visibleFrame, false) }?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let width = max(panel.frame.width, LiuliTheme.panelWidth)
        let cap = min(
            state.followUpOpen ? LiuliTheme.followUpPanelMaxHeight : screen.height - 24,
            screen.height - 24
        )
        var height = min(max(rawHeight, state.followUpOpen ? 240 : 120), cap)
        if growOnly {
            height = max(height, min(panel.frame.height, cap))
            height = min(height, cap)
        }
        panel.minSize = NSSize(width: 320, height: state.followUpOpen ? 240 : 140)
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
        scroll.hasVerticalScroller = false
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
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
    @FocusState private var followUpFocused: Bool
    @State private var followUpMiddleHeight: CGFloat = 0

    private var fillsWindow: Bool {
        state.panelManualSize != nil || state.panelLiveResizing || state.followUpOpen
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LiuliTheme.sectionSpacing) {
            header
            if state.followUpOpen {
                followUpMiddle
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                if let error = state.lastError, !error.isEmpty {
                    errorBanner(error)
                }
                followUpComposer
                footer
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(2)
            } else {
                translateBody
                if showsExpandButton {
                    expandButton
                }
                if let error = state.lastError, !error.isEmpty {
                    errorBanner(error)
                }
                footer
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(2)
            }
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
                Color.clear.preference(key: PanelSizeKey.self, value: reportedSize(geo.size))
            }
        )
        .task {
            await state.refreshCatalog()
        }
        .focusable(false)
        .focusEffectDisabled()
        .ignoresSafeArea()
    }

    private func reportedSize(_ visible: CGSize) -> CGSize {
        guard state.followUpOpen else { return visible }
        let chrome: CGFloat = 22 + 44 + 22 + LiuliTheme.panelPadding * 2 + LiuliTheme.sectionSpacing * 4
        let desired = chrome + followUpMiddleHeight
        return CGSize(
            width: LiuliTheme.panelWidth,
            height: min(max(desired, 240), LiuliTheme.followUpPanelMaxHeight)
        )
    }

    @ViewBuilder
    private var translateBody: some View {
        screenshotBlock
        if showsSource {
            sourceBlock
            Divider().opacity(0.12)
        }
        resultBlock
    }

    @ViewBuilder
    private var followUpMiddle: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: LiuliTheme.sectionSpacing) {
                    screenshotBlock
                    if showsSource {
                        sourceBlockWithoutInnerScroll
                        Divider().opacity(0.12)
                    }
                    resultBlockWithoutInnerScroll
                    followUpMessages
                    Color.clear.frame(height: 1).id("follow-up-tail")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: ContentHeightKey.self, value: geo.size.height)
                    }
                )
            }
            .scrollIndicators(.never)
            .scrollBounceBehavior(.basedOnSize)
            .onPreferenceChange(ContentHeightKey.self) { height in
                guard abs(height - followUpMiddleHeight) > 1 else { return }
                followUpMiddleHeight = height
            }
            .onChange(of: state.followUpMessages.last?.text) { _, _ in
                guard state.streamingFollowUp else { return }
                proxy.scrollTo("follow-up-tail", anchor: .bottom)
            }
        }
    }

    @ViewBuilder
    private var screenshotBlock: some View {
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
    }

    private func errorBanner(_ error: String) -> some View {
        Text(error)
            .font(LiuliTheme.captionFont)
            .foregroundStyle(.red.opacity(0.9))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
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
                GlassScrollView(maxHeight: 96) {
                    sourceTextView
                }
            }
        }
    }

    @ViewBuilder
    private var sourceBlockWithoutInnerScroll: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle("原文", copy: state.copySource, enabled: !state.sourceText.isEmpty)
            if !state.sourceText.isEmpty {
                sourceTextView
            }
        }
    }

    private var sourceTextView: some View {
        Text(state.sourceText)
            .font(LiuliTheme.bodyFont)
            .foregroundStyle(Color.primary.opacity(0.82))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contextMenu {
                Button("拷贝原文") { state.copySource() }
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
                GlassScrollView(maxHeight: resultMaxHeight) {
                    resultTextView
                        .id("result-tail")
                }
                .onChange(of: state.resultText) { _, _ in
                    guard state.isStreaming, !state.streamingFollowUp else { return }
                    proxy.scrollTo("result-tail", anchor: .bottom)
                }
            }
            if state.mode == .latex, !state.resultText.isEmpty, !state.isStreaming {
                GlassScrollView(maxHeight: 160) {
                    LatexPreview(latex: state.resultText)
                        .frame(maxWidth: .infinity, minHeight: 72)
                }
            }
        }
    }

    @ViewBuilder
    private var resultBlockWithoutInnerScroll: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle(
                state.mode == .ocr ? "识别" : (state.mode == .latex ? "LaTeX" : "译文"),
                copy: state.copyResult,
                enabled: !displayResult.isEmpty,
                retry: state.retry
            )
            resultTextView
            if state.mode == .latex, !state.resultText.isEmpty, !state.isStreaming {
                LatexPreview(latex: state.resultText)
                    .frame(maxWidth: .infinity, minHeight: 72)
            }
        }
    }

    private var resultTextView: some View {
        Text(streamingResult)
            .font(state.mode == .ocr ? LiuliTheme.bodyFont : (state.resultText.isEmpty ? LiuliTheme.bodyFont : LiuliTheme.resultFont))
            .foregroundStyle(displayResult.isEmpty && !state.isStreaming ? Color.secondary : Color.primary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contextMenu {
                Button("拷贝") { state.copyResult() }
                    .disabled(displayResult.isEmpty)
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
        let streamingPrimary = state.isStreaming && !state.streamingFollowUp
        if body.isEmpty {
            return streamingPrimary ? "▍" : "…"
        }
        return streamingPrimary ? body + "▍" : body
    }

    private var showsExpandButton: Bool {
        !state.followUpOpen
            && !state.isStreaming
            && !displayResult.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var expandButton: some View {
        Button {
            state.expandFollowUp()
        } label: {
            Text(">")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.secondary)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("简要解释，并可继续追问")
    }

    @ViewBuilder
    private var followUpMessages: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().opacity(0.12)
            ForEach(Array(state.followUpMessages.enumerated()), id: \.element.id) { index, message in
                let isLast = index == state.followUpMessages.count - 1
                Text(followUpDisplay(message, isLast: isLast))
                    .font(message.role == .user ? LiuliTheme.captionFont : LiuliTheme.bodyFont)
                    .foregroundStyle(message.role == .user ? Color.secondary : Color.primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(message.id)
            }
        }
    }

    private var followUpComposer: some View {
        HStack(spacing: 8) {
            TextField("继续追问", text: Bindable(state).followUpDraft)
                .textFieldStyle(.plain)
                .font(LiuliTheme.bodyFont)
                .focused($followUpFocused)
                .onSubmit { state.submitFollowUp() }
                .disabled(state.isStreaming)
            Button {
                state.submitFollowUp()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(canSubmitFollowUp ? Color.accentColor : Color.secondary.opacity(0.35))
            }
            .buttonStyle(.plain)
            .disabled(!canSubmitFollowUp)
            .help("发送")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: LiuliTheme.chipRadius, style: .continuous)
                .fill(Color.primary.opacity(0.05))
        )
        .fixedSize(horizontal: false, vertical: true)
        .layoutPriority(2)
        .onAppear {
            followUpFocused = true
        }
        .onChange(of: state.followUpOpen) { _, open in
            if open { followUpFocused = true }
        }
        .onChange(of: state.isStreaming) { _, streaming in
            if !streaming, state.followUpOpen {
                followUpFocused = true
            }
        }
    }

    private var canSubmitFollowUp: Bool {
        !state.isStreaming
            && !state.followUpDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func followUpDisplay(_ message: FollowUpMessage, isLast: Bool) -> String {
        let streaming = state.streamingFollowUp && isLast && message.role == .assistant
        if message.text.isEmpty {
            return streaming ? "▍" : "…"
        }
        return streaming ? message.text + "▍" : message.text
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
        if state.panelManualSize != nil { return 420 }
        return state.followUpOpen ? 160 : 260
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

private struct ContentHeightKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct GlassScrollView<Content: View>: View {
    var maxHeight: CGFloat
    @ViewBuilder var content: () -> Content
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        let fitted = contentHeight > 0 ? min(contentHeight, maxHeight) : min(36, maxHeight)
        let overflows = contentHeight > fitted + 1

        ScrollView {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: ContentHeightKey.self, value: geo.size.height)
                    }
                )
        }
        .scrollDisabled(!overflows)
        .scrollIndicators(.never)
        .frame(height: fitted, alignment: .topLeading)
        .clipped()
        .onPreferenceChange(ContentHeightKey.self) { height in
            guard abs(height - contentHeight) > 1 else { return }
            contentHeight = height
        }
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
