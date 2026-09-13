import AppKit
import SwiftMath
import SwiftUI

struct LatexPreview: View {
    var latex: String
    @State private var hasParseError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LatexMathLabel(latex: latex, hasParseError: $hasParseError)
                .frame(maxWidth: .infinity, minHeight: 72)
            if hasParseError {
                Text("预览暂不支持该语法，上方源码仍可复制")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private struct LatexMathLabel: NSViewRepresentable {
    var latex: String
    @Binding var hasParseError: Bool

    final class Coordinator {
        var lastParseError = false
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> MTMathUILabel {
        let label = MTMathUILabel()
        label.labelMode = .display
        label.textAlignment = .center
        label.textColor = NSColor.labelColor
        label.displayErrorInline = false
        label.fontSize = 18
        label.contentInsets = MTEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        return label
    }

    func updateNSView(_ label: MTMathUILabel, context: Context) {
        label.latex = LatexSanitize.forPreview(latex)
        let hasError = label.error != nil
        if context.coordinator.lastParseError != hasError {
            context.coordinator.lastParseError = hasError
            DispatchQueue.main.async {
                hasParseError = hasError
            }
        }
    }
}
