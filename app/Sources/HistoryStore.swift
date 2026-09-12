import Foundation

struct HistoryStore: Sendable {
    private let url: URL
    private let limit = 200

    init() {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appending(path: "Liuli")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        url = root.appending(path: "history.jsonl")
    }

    func load(limit max: Int = 40) -> [HistoryEntry] {
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8)
        else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return text.split(separator: "\n").compactMap { line in
            guard let lineData = line.data(using: .utf8) else { return nil }
            return try? decoder.decode(HistoryEntry.self, from: lineData)
        }
        .suffix(max)
        .reversed()
    }

    func append(_ entry: HistoryEntry) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        guard var data = try? encoder.encode(entry) else { return }
        data.append(0x0A)
        if FileManager.default.fileExists(atPath: url.path) {
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: data)
            }
        } else {
            try? data.write(to: url)
        }
        prune()
    }

    func clear() {
        try? FileManager.default.removeItem(at: url)
    }

    private func prune() {
        let newestFirst = load(limit: .max)
        guard newestFirst.count > limit else { return }
        let keep = Array(newestFirst.prefix(limit).reversed())
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var blob = Data()
        for entry in keep {
            if let data = try? encoder.encode(entry) {
                blob.append(data)
                blob.append(0x0A)
            }
        }
        try? blob.write(to: url)
    }
}
