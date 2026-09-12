import AppKit
import SwiftMath
import SwiftUI

struct LatexPreview: NSViewRepresentable {
    var latex: String

    func makeNSView(context: Context) -> MTMathUILabel {
        let label = MTMathUILabel()
        label.labelMode = .display
        label.textAlignment = .center
        label.textColor = NSColor.labelColor
        label.displayErrorInline = true
        label.fontSize = 18
        label.contentInsets = MTEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        return label
    }

    func updateNSView(_ label: MTMathUILabel, context: Context) {
        label.latex = LatexSanitize.forPreview(latex)
    }
}
