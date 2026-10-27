const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { ClipboardStore } = require("../clipboard-store.cjs");

async function fixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "liuli-剪贴板 "));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  return { directory, key, store: await new ClipboardStore(directory, key, options).init() };
}
test("clipboard history searches Unicode, preserves formats and deduplicates by recency", async t => {
  const { store } = await fixture(t, { limit: 3 });
  await store.add({ text: "Ａlpha 你好", html: "<!--StartFragment--><b>你好</b><!--EndFragment-->", sourceApp: "Writer" });
  await store.add({ text: "Beta" });
  const result = store.query("alpha 你好");
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].source, "Writer");
  assert.equal("search" in result.entries[0], false);
  const payload = await store.read(result.entries[0].id);
  assert.equal(payload.text, "Ａlpha 你好"); assert.equal(payload.html, "<b>你好</b>");
  await store.add({ text: "Beta" });
  assert.equal(store.entries.length, 2);
  assert.equal(store.query().entries[0].preview, "Beta");
  assert.equal(await store.add({ text: "Beta" }), false);
  const png = (await fs.readFile(path.resolve(__dirname, "../../docs/assets/icon.png"))).toString("base64");
  await store.add({ pngBase64: png });
  assert.equal(store.query("图片").total, 1);
  const image = store.query("image").entries[0];
  assert.equal(image.width, 256); assert.equal((await store.read(image.id)).pngBase64, png);
});
test("clipboard records persist encrypted, reject tampering and enforce retention under concurrent copies", async t => {
  const { store, directory, key } = await fixture(t, { limit: 3 });
  const secret = "clipboard_fixture_must_never_be_stored_as_plain_text";
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.add({ text: `${secret}_${i}` })));
  assert.equal(store.entries.length, 3);
  const files = await fs.readdir(directory);
  assert.equal(files.filter(f => f.endsWith(".bin")).length, 3);
  for (const file of files) assert.equal((await fs.readFile(path.join(directory, file))).includes(Buffer.from(secret)), false);
  const restored = await new ClipboardStore(directory, key, { limit: 3 }).init();
  assert.equal(restored.query("fixture").total, 3);
  await assert.rejects(new ClipboardStore(directory, randomBytes(32)).init());
  const id = restored.query().entries[0].id;
  const file = path.join(directory, id + ".bin"), encrypted = await fs.readFile(file);
  encrypted[encrypted.length - 1] ^= 1; await fs.writeFile(file, encrypted);
  await assert.rejects(restored.read(id));
});
test("clearing waits for earlier writes and does not resurrect deleted copies", async t => {
  const { store, directory } = await fixture(t);
  await Promise.all([store.add({ text: "before one" }), store.add({ text: "before two" }), store.clear(), store.add({ text: "after" })]);
  assert.deepEqual(store.query().entries.map(e => e.preview), ["after"]);
  assert.equal((await fs.readdir(directory)).filter(f => f.endsWith(".bin")).length, 1);
  await store.remove(store.query().entries[0].id);
  assert.equal(store.entries.length, 0);
  await assert.rejects(store.read("../../outside"));
});
test("oversized or invalid copies are skipped and lowering the limit prunes old records", async t => {
  const { store } = await fixture(t);
  assert.equal(await store.add({ text: "x".repeat(1024 * 1024 + 1) }), false);
  assert.equal(await store.add({ pngBase64: "not a PNG" }), false);
  assert.equal(await store.add({}), false);
  await Promise.all(["one", "two", "three"].map(text => store.add({ text })));
  await store.configure(2);
  assert.deepEqual(store.query().entries.map(e => e.preview), ["three", "two"]);
});
