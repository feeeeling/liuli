import AppKit
import Carbon
import Foundation

enum HotKeyAction: String, CaseIterable, Identifiable {
    case translateSelection
    case screenshotTranslate
    case screenshotOCR
    case formulaLatex
    case inputTranslate
    case silentOCR

    var id: String { rawValue }

    var title: String {
        switch self {
        case .translateSelection: "选中翻译"
        case .screenshotTranslate: "截图翻译"
        case .screenshotOCR: "截图 OCR"
        case .formulaLatex: "公式转 LaTeX"
        case .inputTranslate: "输入翻译"
        case .silentOCR: "静默 OCR"
        }
    }

    var carbonID: UInt32 {
        switch self {
        case .translateSelection: 1
        case .screenshotTranslate: 2
        case .screenshotOCR: 3
        case .formulaLatex: 4
        case .inputTranslate: 5
        case .silentOCR: 6
        }
    }

    var defaultChord: KeyChord {
        switch self {
        case .translateSelection: KeyChord(keyCode: UInt32(kVK_ANSI_D), modifiers: UInt32(optionKey))
        case .screenshotTranslate: KeyChord(keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey))
        case .screenshotOCR: KeyChord(keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey | shiftKey))
        case .formulaLatex: KeyChord(keyCode: UInt32(kVK_ANSI_L), modifiers: UInt32(optionKey))
        case .inputTranslate: KeyChord(keyCode: UInt32(kVK_ANSI_A), modifiers: UInt32(optionKey))
        case .silentOCR: KeyChord(keyCode: UInt32(kVK_ANSI_C), modifiers: UInt32(optionKey))
        }
    }
}

struct KeyChord: Codable, Equatable {
    var keyCode: UInt32
    var modifiers: UInt32

    var display: String {
        var parts = ""
        if modifiers & UInt32(controlKey) != 0 { parts += "⌃" }
        if modifiers & UInt32(optionKey) != 0 { parts += "⌥" }
        if modifiers & UInt32(shiftKey) != 0 { parts += "⇧" }
        if modifiers & UInt32(cmdKey) != 0 { parts += "⌘" }
        parts += KeyChord.keyName(keyCode)
        return parts
    }

    static func from(event: NSEvent) -> KeyChord? {
        if event.keyCode == 53 { return nil }
        var mods: UInt32 = 0
        if event.modifierFlags.contains(.control) { mods |= UInt32(controlKey) }
        if event.modifierFlags.contains(.option) { mods |= UInt32(optionKey) }
        if event.modifierFlags.contains(.shift) { mods |= UInt32(shiftKey) }
        if event.modifierFlags.contains(.command) { mods |= UInt32(cmdKey) }
        guard mods != 0 else { return nil }
        return KeyChord(keyCode: UInt32(event.keyCode), modifiers: mods)
    }

    private static func keyName(_ code: UInt32) -> String {
        let map: [UInt32: String] = [
            UInt32(kVK_ANSI_A): "A", UInt32(kVK_ANSI_B): "B", UInt32(kVK_ANSI_C): "C",
            UInt32(kVK_ANSI_D): "D", UInt32(kVK_ANSI_E): "E", UInt32(kVK_ANSI_F): "F",
            UInt32(kVK_ANSI_G): "G", UInt32(kVK_ANSI_H): "H", UInt32(kVK_ANSI_I): "I",
            UInt32(kVK_ANSI_J): "J", UInt32(kVK_ANSI_K): "K", UInt32(kVK_ANSI_L): "L",
            UInt32(kVK_ANSI_M): "M", UInt32(kVK_ANSI_N): "N", UInt32(kVK_ANSI_O): "O",
            UInt32(kVK_ANSI_P): "P", UInt32(kVK_ANSI_Q): "Q", UInt32(kVK_ANSI_R): "R",
            UInt32(kVK_ANSI_S): "S", UInt32(kVK_ANSI_T): "T", UInt32(kVK_ANSI_U): "U",
            UInt32(kVK_ANSI_V): "V", UInt32(kVK_ANSI_W): "W", UInt32(kVK_ANSI_X): "X",
            UInt32(kVK_ANSI_Y): "Y", UInt32(kVK_ANSI_Z): "Z",
        ]
        return map[code] ?? "Key\(code)"
    }
}

@MainActor
final class HotKeyManager {
    private var refs: [EventHotKeyRef?] = []
    private var handler: EventHandlerRef?
    private let state: AppState
    private var localMonitor: Any?
    private var clickMonitor: Any?

    init(state: AppState) {
        self.state = state
        installHandler()
        reregister()
        state.onHotKeysChanged = { [weak self] in self?.reregister() }

        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53, self?.state.isPanelVisible == true {
                self?.state.hideIfAllowed()
                return nil
            }
            return event
        }
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            self?.state.hideIfAllowed()
        }
    }

    func reregister() {
        for ref in refs {
            if let ref { UnregisterEventHotKey(ref) }
        }
        refs.removeAll()
        for action in HotKeyAction.allCases {
            let chord = state.chord(for: action)
            var ref: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: fourChar("LIUL"), id: action.carbonID)
            let status = RegisterEventHotKey(
                chord.keyCode,
                chord.modifiers,
                hotKeyID,
                GetApplicationEventTarget(),
                0,
                &ref
            )
            if status == noErr {
                refs.append(ref)
            } else {
                NSLog("[liuli] RegisterEventHotKey \(action.rawValue) failed: \(status)")
            }
        }
    }

    private func installHandler() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        let callback: EventHandlerUPP = { _, event, userData in
            guard let userData, let event else { return noErr }
            var hotKeyID = EventHotKeyID()
            GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            let id = hotKeyID.id
            Task { @MainActor in
                let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
                manager.handle(id: id)
            }
            return noErr
        }
        InstallEventHandler(GetApplicationEventTarget(), callback, 1, &spec, context, &handler)
    }

    private func handle(id: UInt32) {
        switch HotKeyAction.allCases.first(where: { $0.carbonID == id }) {
        case .translateSelection: state.translateSelection()
        case .screenshotTranslate: state.screenshotTranslate()
        case .screenshotOCR: state.screenshotOCR()
        case .formulaLatex: state.formulaToLatex()
        case .inputTranslate: state.inputTranslate()
        case .silentOCR: state.silentOCR()
        case .none: break
        }
    }
}

private func fourChar(_ string: String) -> OSType {
    var result: OSType = 0
    for scalar in string.unicodeScalars.prefix(4) {
        result = (result << 8) + OSType(scalar.value)
    }
    return result
}
