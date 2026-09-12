import Foundation

enum LatexSanitize {
    static func forCopy(_ raw: String) -> String {
        unwrap(raw)
    }

    static func forPreview(_ raw: String) -> String {
        var tex = unwrap(raw)
        tex = tex.replacingOccurrences(of: "\\begin{aligned}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{aligned}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{align*}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{align*}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{align}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{align}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{gather*}", with: "\\begin{array}{c}")
        tex = tex.replacingOccurrences(of: "\\end{gather*}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{gather}", with: "\\begin{array}{c}")
        tex = tex.replacingOccurrences(of: "\\end{gather}", with: "\\end{array}")
        tex = replaceSubstack(tex)
        return tex
    }

    private static func unwrap(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {
            if let first = text.firstIndex(of: "\n") {
                text = String(text[text.index(after: first)...])
            }
            if let fence = text.range(of: "```", options: .backwards) {
                text = String(text[..<fence.lowerBound])
            }
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if text.hasPrefix("$$"), text.hasSuffix("$$"), text.count >= 4 {
            text = String(text.dropFirst(2).dropLast(2))
        } else if text.hasPrefix("\\["), text.hasSuffix("\\]"), text.count >= 4 {
            text = String(text.dropFirst(2).dropLast(2))
        } else if text.hasPrefix("$"), text.hasSuffix("$"), text.count >= 2 {
            text = String(text.dropFirst().dropLast())
        } else if text.hasPrefix("\\("), text.hasSuffix("\\)"), text.count >= 4 {
            text = String(text.dropFirst(2).dropLast(2))
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replaceSubstack(_ tex: String) -> String {
        var result = tex
        while let range = result.range(of: "\\substack{") {
            let start = range.upperBound
            var depth = 1
            var idx = start
            var found: String.Index?
            while idx < result.endIndex {
                let ch = result[idx]
                if ch == "{" { depth += 1 }
                if ch == "}" {
                    depth -= 1
                    if depth == 0 {
                        found = idx
                        break
                    }
                }
                idx = result.index(after: idx)
            }
            guard let end = found else { break }
            let inner = result[start ..< end]
            let replacement = "\\begin{array}{c}\(inner)\\end{array}"
            result.replaceSubrange(range.lowerBound ..< result.index(after: end), with: replacement)
        }
        return result
    }
}
