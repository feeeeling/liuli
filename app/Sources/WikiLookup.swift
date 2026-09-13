import Foundation

enum WikiLookup {
    static func defaultRoot() -> String {
        if let env = ProcessInfo.processInfo.environment["LLM_WIKI_ROOT"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty
        {
            return env
        }
        let guess = (NSHomeDirectory() as NSString).appendingPathComponent("Documents/Code/llm-wiki")
        let index = (guess as NSString).appendingPathComponent("wiki/index.md")
        if FileManager.default.fileExists(atPath: index) {
            return guess
        }
        return ""
    }
}
