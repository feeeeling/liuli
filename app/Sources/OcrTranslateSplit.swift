import Foundation

enum OcrTranslateSplit {
    struct Result {
        var source: String
        var translation: String
        var raw: String
    }

    static func parse(_ raw: String) -> Result {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let marked = split(text, start: "<<<原文>>>", end: "<<<译文>>>") {
            return Result(source: marked.0, translation: marked.1, raw: text)
        }
        if let labeled = splitLabeled(text) {
            return Result(source: labeled.0, translation: labeled.1, raw: text)
        }
        return Result(source: "", translation: "", raw: text)
    }

    private static func split(_ text: String, start: String, end: String) -> (String, String)? {
        guard let startRange = text.range(of: start),
              let endRange = text.range(of: end, range: startRange.upperBound ..< text.endIndex)
        else { return nil }
        let source = text[startRange.upperBound ..< endRange.lowerBound]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let translation = text[endRange.upperBound...]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if source.isEmpty, translation.isEmpty { return nil }
        return (source, translation)
    }

    private static func splitLabeled(_ text: String) -> (String, String)? {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let index = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "译文" })
        else { return nil }
        var sourceLines = Array(lines[..<index])
        if sourceLines.first?.trimmingCharacters(in: .whitespaces) == "原文" {
            sourceLines.removeFirst()
        }
        let source = sourceLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let translation = lines[(index + 1)...].joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if source.isEmpty, translation.isEmpty { return nil }
        return (source, translation)
    }
}
