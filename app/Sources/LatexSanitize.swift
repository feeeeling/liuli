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
        tex = tex.replacingOccurrences(of: "\\begin{multline*}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{multline*}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{multline}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{multline}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{eqnarray*}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{eqnarray*}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{eqnarray}", with: "\\begin{array}{l}")
        tex = tex.replacingOccurrences(of: "\\end{eqnarray}", with: "\\end{array}")
        tex = tex.replacingOccurrences(of: "\\begin{equation*}", with: "")
        tex = tex.replacingOccurrences(of: "\\end{equation*}", with: "")
        tex = tex.replacingOccurrences(of: "\\begin{equation}", with: "")
        tex = tex.replacingOccurrences(of: "\\end{equation}", with: "")
        tex = replacing(pattern: #"\\operatorname\*?\s*\{"#, with: #"\\mathrm{"#, in: tex)
        tex = replacing(pattern: #"\\label\s*\{[^{}]*\}"#, with: "", in: tex)
        tex = replacing(pattern: #"\\tag\*?\s*\{[^{}]*\}"#, with: "", in: tex)
        tex = replacing(pattern: #"\\nonumber\b|\\notag\b"#, with: "", in: tex)
        tex = replaceSubstack(tex)
        return tex.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func unwrap(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```"), let first = text.firstIndex(of: "\n") {
            var fenced = String(text[text.index(after: first)...])
            if let fence = fenced.range(of: "```", options: .backwards),
               fenced[fence.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
                fenced = String(fenced[..<fence.lowerBound])
            }
            text = fenced.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        while true {
            if text.hasPrefix("$$"), text.hasSuffix("$$"), text.count >= 4 {
                text = String(text.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }
            if text.hasPrefix("\\["), text.hasSuffix("\\]"), text.count >= 4 {
                text = String(text.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }
            if text.hasPrefix("\\("), text.hasSuffix("\\)"), text.count >= 4 {
                text = String(text.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }
            if text.hasPrefix("$"), text.hasSuffix("$"), text.count >= 2 {
                text = String(text.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }
            break
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replacing(pattern: String, with replacement: String, in text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
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
