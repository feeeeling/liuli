import ClipboardCore
import Foundation
import Testing

private func archive(limit: Int = 500, budget: Int = 128 * 1024 * 1024) async throws -> (URL, Data, ClipboardArchive) {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("liuli-clipboard-test-\(UUID())")
    let key = Data(repeating: 42, count: 32)
    let archive = try ClipboardArchive(directory: directory, key: key, limit: limit, budget: budget)
    try await archive.load()
    return (directory, key, archive)
}
private func text(_ value: String, html: String? = nil) -> ClipboardSnapshot {
    var formats = ["public.utf8-plain-text": Data(value.utf8)]
    if let html { formats["public.html"] = Data(html.utf8) }
    return ClipboardSnapshot(formats: formats, text: value, source: "Test Writer")
}
@Test func unicodeSearchAndRichFormats() async throws {
    let (directory, _, store) = try await archive(); defer { try? FileManager.default.removeItem(at: directory) }
    try await store.add(text("Ａlpha 你好 😀", html: "<b>你好</b>")); try await store.add(text("Beta"))
    let result = await store.query("alpha 你好"); #expect(result.total == 1)
    let payload = try await store.read(result.records[0].id)
    #expect(payload["public.html"] == Data("<b>你好</b>".utf8))
    #expect(payload["public.utf8-plain-text"] == Data("Ａlpha 你好 😀".utf8))
    try await store.add(text("Beta")); #expect(await store.query().count == 2)
    #expect(await store.query().records.first?.preview == "Beta")
    #expect(try await store.add(text("Beta")) == false)
}
@Test func encryptedPersistenceAndRetention() async throws {
    let (directory, key, store) = try await archive(limit: 3); defer { try? FileManager.default.removeItem(at: directory) }
    let secret = "PRIVATE_CLIPBOARD_TEST_SENTINEL"
    try await withThrowingTaskGroup(of: Void.self) { group in
        for index in 0..<20 { group.addTask { try await store.add(text("\(secret)_\(index)")) } }
        try await group.waitForAll()
    }
    #expect(await store.query().count == 3)
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    #expect(files.filter { $0.pathExtension == "bin" }.count == 3)
    for file in files { #expect(try Data(contentsOf: file).range(of: Data(secret.utf8)) == nil) }
    let restored = try ClipboardArchive(directory: directory, key: key); try await restored.load()
    #expect(await restored.query(secret).total == 3)
    let wrong = try ClipboardArchive(directory: directory, key: Data(repeating: 1, count: 32))
    do { try await wrong.load(); Issue.record("Wrong key accepted") } catch { }
}
@Test func tamperingAndDeletedRecordsAreRejected() async throws {
    let (directory, _, store) = try await archive(); defer { try? FileManager.default.removeItem(at: directory) }
    try await store.add(text("tamper test")); let record = try #require(await store.query().records.first)
    let file = directory.appendingPathComponent(record.id.uuidString).appendingPathExtension("bin")
    var data = try Data(contentsOf: file); data[data.count - 1] ^= 1; try data.write(to: file)
    do { _ = try await store.read(record.id); Issue.record("Tampered record accepted") } catch { }
    try await store.clear(); #expect(await store.query().count == 0)
    #expect(try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).allSatisfy { $0.pathExtension != "bin" })
    do { _ = try await store.read(record.id); Issue.record("Deleted record accepted") } catch { }
}
@Test func limitsAndUnsupportedFormats() async throws {
    let (directory, _, store) = try await archive(); defer { try? FileManager.default.removeItem(at: directory) }
    #expect(try await store.add(text(String(repeating: "x", count: 1024 * 1024 + 1))) == false)
    #expect(try await store.add(ClipboardSnapshot(formats: ["public.file-url": Data("file:///private".utf8)])) == false)
    for value in ["one", "two", "three"] { try await store.add(text(value)) }
    try await store.configure(limit: 2)
    #expect(await store.query().records.map(\.preview) == ["three", "two"])
    let record = try #require(await store.query().records.first); try await store.remove(record.id)
    #expect(await store.query().count == 1)
}
@Test func imageAndBudget() async throws {
    let (directory, _, store) = try await archive(budget: 4096); defer { try? FileManager.default.removeItem(at: directory) }
    let png = Data([137,80,78,71,13,10,26,10])
    try await store.add(ClipboardSnapshot(formats: ["public.png": png], thumbnail: png, width: 1, height: 1))
    let record = try #require(await store.query("image").records.first)
    #expect(record.isImage); #expect(record.thumbnail == png)
    #expect(try await store.read(record.id)["public.png"] == png)
    #expect(try await store.add(text(String(repeating: "large", count: 2000))) == false)
}
