import AppKit
import ClipboardCore
import ClipboardMac
import SwiftUI

@MainActor
final class ClipboardPanelController: NSObject, NSWindowDelegate {
    private let history: ClipboardHistory
    private let settings: () -> Void
    private var panel: ClipboardPanel?
    private var previousApp: NSRunningApplication?
    private weak var previousWindow: NSWindow?
    private var keyMonitor: Any?

    init(history: ClipboardHistory, settings: @escaping () -> Void) {
        self.history = history; self.settings = settings
        super.init()
        history.onToggle = { [weak self] in self?.toggle() }
        history.onDismiss = { [weak self] restore in self?.hide(restore: restore) }
        history.onSizeChanged = { [weak self] in self?.fit() }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.panel?.isKeyWindow == true else { return event }
            if let editor = self.panel?.firstResponder as? NSTextView, editor.hasMarkedText() { return event }
            guard !event.modifierFlags.contains(.command) || event.keyCode == 51 else { return event }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == 53 { self.hide(); return nil }
            if event.keyCode == 125 || event.keyCode == 126 {
                self.history.moveSelection(event.keyCode == 125 ? 1 : -1); return nil
            }
            if event.keyCode == 51 && flags.contains(.command) { Task { await self.history.removeSelected() }; return nil }
            if flags.contains(.option), let text = event.charactersIgnoringModifiers, let digit = Int(text), (1...9).contains(digit) {
                Task { await self.history.copySelected(index: digit - 1) }; return nil
            }
            return event
        }
    }
    private func ensurePanel() -> ClipboardPanel {
        if let panel { return panel }
        let panel = ClipboardPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 260),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.delegate = self; panel.isFloatingPanel = true; panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.hidesOnDeactivate = false; panel.sharingType = .none
        let root = ClipboardHistoryView(history: history) { [weak self] in self?.hide(restore: false); self?.settings() }
        let host = NSHostingView(rootView: root); host.sizingOptions = []; host.safeAreaRegions = []
        panel.contentView = GlassChrome.wrap(host)
        self.panel = panel
        return panel
    }
    private func toggle() {
        if history.isVisible { hide(); return }
        previousApp = NSWorkspace.shared.frontmostApplication
        previousWindow = NSApp.keyWindow
        let panel = ensurePanel()
        history.prepareToShow()
        let mouse = NSEvent.mouseLocation
        let visible = (NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        panel.setFrameOrigin(NSPoint(x: min(max(mouse.x + 12, visible.minX + 12), visible.maxX - panel.frame.width - 12),
            y: min(max(mouse.y - panel.frame.height - 12, visible.minY + 12), visible.maxY - panel.frame.height - 12)))
        fit(); NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
    }
    private func fit() {
        guard let panel, history.isVisible else { return }
        let visible = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let height = min(CGFloat(124 + max(1, min(history.records.count, 7)) * 64), 520, visible.height - 24)
        let width = min(CGFloat(480), visible.width - 24)
        var frame = panel.frame
        let top = min(frame.maxY, visible.maxY - 12)
        frame.size = NSSize(width: width, height: height)
        frame.origin.y = max(visible.minY + 12, top - height)
        frame.origin.x = max(visible.minX + 12, min(frame.minX, visible.maxX - width - 12))
        panel.setFrame(frame, display: true)
    }
    private func hide(restore: Bool = true) {
        guard let panel, history.isVisible else { return }
        let canRestore = restore && NSApp.isActive && panel.isKeyWindow
        history.isVisible = false; panel.orderOut(nil)
        if canRestore {
            if let app = previousApp, app.processIdentifier != ProcessInfo.processInfo.processIdentifier, !app.isTerminated { app.activate(options: []) }
            else if let window = previousWindow, window.isVisible { window.makeKeyAndOrderFront(nil) }
        }
    }
    func windowDidResignKey(_ notification: Notification) { hide(restore: false) }
}

private final class ClipboardPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private struct ClipboardHistoryView: View {
    @Bindable var history: ClipboardHistory
    var settings: () -> Void
    @FocusState private var searchFocused: Bool
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("搜索复制记录…", text: $history.query)
                    .textFieldStyle(.plain).focused($searchFocused)
                    .onSubmit { Task { await history.copySelected() } }
                    .disabled(history.usingRecord)
                Button("Esc") { history.dismiss() }.buttonStyle(.plain).font(.caption2).foregroundStyle(.tertiary)
            }.padding(16)
            Divider().opacity(0.4)
            if history.records.isEmpty {
                Text(history.query.isEmpty ? "复制文字或图片后，会出现在这里" : "没有匹配的记录")
                    .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(Array(history.records.enumerated()), id: \.element.id) { index, record in
                                row(record, index: index).id(record.id)
                            }
                        }.padding(6)
                    }.scrollIndicators(.never)
                        .onChange(of: history.selectedID) { _, id in if let id { proxy.scrollTo(id, anchor: nil) } }
                }
            }
            Divider().opacity(0.4)
            HStack {
                Text(history.status).lineLimit(2)
                Spacer(minLength: 4)
                Button(history.enabled ? "暂停记录" : "继续记录") { history.setEnabled(!history.enabled) }.buttonStyle(.plain)
                Button(action: settings) { Image(systemName: "gearshape") }.buttonStyle(.plain).help("剪贴板设置")
            }.font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.top, 9)
            HStack(spacing: 14) { Text("↑↓ 选择"); Text("↵ 复制"); Text("⌘⌫ 删除"); Spacer() }
                .font(.caption2).foregroundStyle(.tertiary).padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 12)
        }
        .onAppear { searchFocused = true }
        .onChange(of: history.isVisible) { _, visible in if visible { searchFocused = true } }
    }
    private func row(_ record: ClipboardRecord, index: Int) -> some View {
        let selected = record.id == history.selectedID
        return Button {
            history.selectedID = record.id
            Task { await history.copySelected() }
        } label: {
            HStack(spacing: 10) {
                Group {
                    if let data = record.thumbnail, let image = NSImage(data: data) { Image(nsImage: image).resizable().scaledToFit() }
                    else { Image(systemName: record.isImage ? "photo" : "text.alignleft").foregroundStyle(selected ? .white.opacity(0.8) : .secondary) }
                }.frame(width: 32, height: 32).background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 3) {
                    Text(record.preview).font(.system(size: 12)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(record.source) · \(record.date.formatted(date: .numeric, time: .shortened))")
                        .font(.system(size: 10)).foregroundStyle(selected ? .white.opacity(0.8) : .secondary).lineLimit(1)
                }
                if index < 9 { Text("⌥\(index + 1)").font(.system(size: 10)).foregroundStyle(selected ? .white.opacity(0.7) : .secondary) }
            }.padding(.horizontal, 10).padding(.vertical, 9).frame(minHeight: 55)
                .foregroundStyle(selected ? Color.white : Color.primary)
                .background(selected ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(history.usingRecord)
    }
}
