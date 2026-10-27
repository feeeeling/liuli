import CryptoKit
import Foundation

public struct ClipboardSnapshot: Sendable {
    public var formats: [String: Data]
    public var text: String
    public var source: String
    public var thumbnail: Data?
    public var width: Int?
    public var height: Int?
    public init(formats: [String: Data], text: String = "", source: String = "", thumbnail: Data? = nil, width: Int? = nil, height: Int? = nil) {
        self.formats = formats; self.text = text; self.source = source
        self.thumbnail = thumbnail; self.width = width; self.height = height
    }
}

public struct ClipboardRecord: Codable, Identifiable, Sendable {
    public let id: UUID
    public var date: Date
    public let preview: String
    public let source: String
    public let thumbnail: Data?
    public let width: Int?
    public let height: Int?
    public let isImage: Bool
}

public enum ClipboardArchiveError: Error { case invalidKey, invalidIndex, missingRecord }

/// All encryption, indexing and disk access stays off the AppKit main actor.
public actor ClipboardArchive {
    private struct Entry: Codable {
        var record: ClipboardRecord
        let hash: Data
        let search: String
        var bytes: Int
    }
    private struct Index: Codable { let version: Int; let entries: [Entry] }
    private let directory: URL
    private let key: SymmetricKey
    private var limit: Int
    private let budget: Int
    private var entries: [Entry] = []
    private let encoder: JSONEncoder = { let value = JSONEncoder(); value.outputFormatting = .sortedKeys; return value }()
    private let decoder = JSONDecoder()
    private static let allowed = Set(["public.utf8-plain-text", "public.html", "public.rtf", "public.png"])

    public init(directory: URL, key: Data, limit: Int = 500, budget: Int = 128 * 1024 * 1024) throws {
        guard key.count == 32 else { throw ClipboardArchiveError.invalidKey }
        self.directory = directory; self.key = SymmetricKey(data: key)
        self.limit = max(1, min(1000, limit)); self.budget = budget
    }
    public func load() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var resource = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? resource.setResourceValues(values)
        let indexURL = directory.appendingPathComponent("history.idx")
        if FileManager.default.fileExists(atPath: indexURL.path) {
            let index = try decoder.decode(Index.self, from: open(Data(contentsOf: indexURL)))
            guard index.version == 1, index.entries.count <= 1000 else { throw ClipboardArchiveError.invalidIndex }
            entries = index.entries
        }
        try prune()
        // Clean records left behind by an interrupted atomic index update.
        let keep = Set(entries.map { $0.record.id })
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            if file.pathExtension == "bin", let id = UUID(uuidString: file.deletingPathExtension().lastPathComponent), !keep.contains(id) {
                try FileManager.default.removeItem(at: file)
            }
        }
    }
    private func normalized(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }
    private func seal(_ data: Data) throws -> Data { try AES.GCM.seal(data, using: key).combined! }
    private func open(_ data: Data) throws -> Data { try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key) }
    private func recordURL(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString).appendingPathExtension("bin") }
    private func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    private func saveIndex() throws { try write(seal(encoder.encode(Index(version: 1, entries: entries))), to: directory.appendingPathComponent("history.idx")) }
    private func prune() throws {
        var removed: [UUID] = []
        while entries.count > limit || entries.reduce(0, { $0 + $1.bytes }) > budget {
            guard let last = entries.popLast() else { break }
            removed.append(last.record.id)
        }
        if !removed.isEmpty {
            try saveIndex()
            for id in removed { try FileManager.default.removeItem(at: recordURL(id)) }
        }
    }
    @discardableResult public func add(_ snapshot: ClipboardSnapshot) throws -> Bool {
        guard !snapshot.formats.isEmpty, Set(snapshot.formats.keys).isSubset(of: Self.allowed),
              snapshot.text.utf8.count <= 1024 * 1024,
              snapshot.thumbnail?.count ?? 0 <= 100_000,
              snapshot.formats.contains(where: { !$0.value.isEmpty }) else { return false }
        for (type, data) in snapshot.formats {
            let cap = type == "public.png" ? 8 * 1024 * 1024 : type == "public.utf8-plain-text" ? 1024 * 1024 : 2 * 1024 * 1024
            guard data.count <= cap else { return false }
        }
        let encoded = try encoder.encode(snapshot.formats)
        let hash = Data(SHA256.hash(data: encoded))
        if let index = entries.firstIndex(where: { $0.hash == hash }) {
            guard index != 0 else { return false }
            var entry = entries.remove(at: index); entry.record.date = Date(); entries.insert(entry, at: 0)
            try saveIndex(); return true
        }
        let image = snapshot.formats["public.png"] != nil
        let collapsed = snapshot.text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let preview = collapsed.isEmpty ? (image ? "图片 \(snapshot.width ?? 0) × \(snapshot.height ?? 0)" : "富文本") : String(collapsed.prefix(180))
        let record = ClipboardRecord(id: UUID(), date: Date(), preview: preview, source: String(snapshot.source.prefix(128)), thumbnail: snapshot.thumbnail,
            width: snapshot.width, height: snapshot.height, isImage: image)
        let encrypted = try seal(encoded)
        var entry = Entry(record: record, hash: hash,
            search: normalized("\(snapshot.text.prefix(32768)) \(record.source) \(preview) \(image ? "图片 image" : "文字 text")"), bytes: 0)
        entry.bytes = encrypted.count + (try encoder.encode(entry).count) + 256
        guard entry.bytes <= budget else { return false }
        try write(encrypted, to: recordURL(record.id)); entries.insert(entry, at: 0)
        try prune(); try saveIndex(); return true
    }
    public func query(_ query: String = "", maximum: Int = 60) -> (total: Int, records: [ClipboardRecord], count: Int) {
        let terms = normalized(String(query.prefix(1000))).split(whereSeparator: { $0.isWhitespace })
        let matches = entries.filter { entry in terms.allSatisfy { entry.search.contains($0) } }
        return (matches.count, Array(matches.prefix(max(1, min(maximum, 100)))).map(\.record), entries.count)
    }
    public func read(_ id: UUID) throws -> [String: Data] {
        guard let index = entries.firstIndex(where: { $0.record.id == id }) else { throw ClipboardArchiveError.missingRecord }
        let payload = try decoder.decode([String: Data].self, from: open(Data(contentsOf: recordURL(id))))
        var entry = entries.remove(at: index); entry.record.date = Date(); entries.insert(entry, at: 0)
        try saveIndex(); return payload
    }
    public func remove(_ id: UUID) throws {
        entries.removeAll { $0.record.id == id }; try saveIndex()
        let url = recordURL(id); if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    public func clear() throws {
        entries = []; try saveIndex()
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            if file.pathExtension == "bin", UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil { try FileManager.default.removeItem(at: file) }
        }
    }
    public func configure(limit: Int) throws { self.limit = max(1, min(1000, limit)); try prune() }
}
