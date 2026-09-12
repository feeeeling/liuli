import AppKit
import SwiftUI

struct HotKeyRecorderRow: View {
    @Environment(AppState.self) private var state
    var action: HotKeyAction
    @State private var capturing = false
    @State private var monitor: Any?

    var body: some View {
        HStack {
            Text(action.title)
            Spacer()
            Button(capturing ? "按下组合键…" : state.chord(for: action).display) {
                startCapture()
            }
            .buttonStyle(.bordered)
        }
        .onDisappear { stopCapture() }
    }

    private func startCapture() {
        stopCapture()
        capturing = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 {
                stopCapture()
                return nil
            }
            if let chord = KeyChord.from(event: event) {
                state.setChord(chord, for: action)
                stopCapture()
                return nil
            }
            return event
        }
    }

    private func stopCapture() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
        capturing = false
    }
}
