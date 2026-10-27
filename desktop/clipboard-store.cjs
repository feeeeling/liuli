const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } = require("node:crypto");

const normalize = value => value.normalize("NFKC").toLocaleLowerCase();
const validId = id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
function encrypt(value, key) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]);
}
function decrypt(data, key) {
  if (data.length < 28) throw new Error("Invalid clipboard history");
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"));
}

class ClipboardStore {
  constructor(directory, key, { limit = 500, budget = 128 * 1024 * 1024 } = {}) {
    if (key.length !== 32) throw new Error("Invalid history key");
    this.directory = directory;
    this.key = Buffer.from(key);
    this.limit = Math.max(1, Math.min(1000, limit));
    this.budget = budget;
    this.entries = [];
    this.writes = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const index = decrypt(await fs.readFile(path.join(this.directory, "history.idx")), this.key);
      if (index.version !== 1 || !Array.isArray(index.entries)) throw new Error("Invalid clipboard index");
      this.entries = index.entries.filter(e => validId(e.id) && typeof e.hash === "string" &&
        typeof e.search === "string" && typeof e.preview === "string" && Number.isFinite(e.bytes)).slice(0, 1000);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await this.prune();
    return this;
  }
  serial(callback) {
    const result = this.writes.then(callback);
    this.writes = result.catch(() => {});
    return result;
  }
  async atomic(file, bytes) {
    const temp = file + ".tmp";
    await fs.writeFile(temp, bytes, { mode: 0o600 });
    await fs.rename(temp, file);
  }
  async saveIndex() {
    await this.atomic(path.join(this.directory, "history.idx"), encrypt({ version: 1, entries: this.entries }, this.key));
  }
  get bytes() { return this.entries.reduce((sum, entry) => sum + entry.bytes + (entry.overhead || 0), 0); }
  async prune() {
    const removed = [];
    while (this.entries.length > this.limit || this.bytes > this.budget) removed.push(this.entries.pop());
    if (!removed.length) return;
    await this.saveIndex();
    await Promise.all(removed.map(e => fs.rm(path.join(this.directory, e.id + ".bin"), { force: true })));
  }
  add(input) {
    return this.serial(async () => {
      let text = typeof input.text === "string" ? input.text : "";
      let html = typeof input.html === "string" ? input.html : "";
      if (Buffer.byteLength(text) > 1024 * 1024 || Buffer.byteLength(html) > 2 * 1024 * 1024) return false;
      const fragment = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
      if (fragment) html = fragment[1];
      else if (/^Version:/i.test(html)) html = html.slice(Math.max(0, html.search(/<html[\s>]/i)));
      const png = typeof input.pngBase64 === "string" ? input.pngBase64 : "";
      if (png.length > 12 * 1024 * 1024) return false;
      const image = png ? Buffer.from(png, "base64") : null;
      if (image && (image.length > 8 * 1024 * 1024 || image.length < 24 ||
          !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) return false;
      if (!text && !html && !image) return false;
      const hash = createHash("sha256").update(text).update("\0").update(html).update("\0").update(image || "").digest("hex");
      const existing = this.entries.findIndex(e => e.hash === hash);
      if (existing === 0) return false;
      if (existing > 0) {
        const [entry] = this.entries.splice(existing, 1);
        entry.timestamp = Date.now(); this.entries.unshift(entry);
        await this.saveIndex(); return true;
      }
      const id = randomUUID();
      const payload = encrypt({ text, html, pngBase64: png }, this.key);
      const source = String(input.sourceApp || "").replace(/[\u0000-\u001f]/g, "").slice(0, 128);
      const type = image ? "image" : "text";
      const width = image ? image.readUInt32BE(16) : undefined, height = image ? image.readUInt32BE(20) : undefined;
      if (image && (!width || !height || width > 16384 || height > 16384 || width * height > 33554432)) return false;
      const preview = text.replace(/\s+/g, " ").trim().slice(0, 180) || (image ? `图片 ${width} × ${height}` : html ? "富文本" : "空白文本");
      const thumbnail = image && typeof input.thumbnail === "string" && input.thumbnail.length <= 100000 ? input.thumbnail : undefined;
      const entry = { id, hash, type, timestamp: Date.now(), preview, source, width, height, thumbnail,
        search: normalize(`${text.slice(0, 32768)} ${source} ${image ? "图片 image" : "文字 text"} ${preview}`), bytes: payload.length };
      entry.overhead = Buffer.byteLength(JSON.stringify(entry)) + 256;
      if (entry.bytes + entry.overhead > this.budget) return false;
      await this.atomic(path.join(this.directory, id + ".bin"), payload);
      this.entries.unshift(entry);
      await this.prune();
      await this.saveIndex();
      return true;
    });
  }
  query(query = "", count = 60) {
    const terms = normalize(String(query).slice(0, 1000)).trim().split(/\s+/).filter(Boolean);
    const matches = this.entries.filter(e => terms.every(term => e.search.includes(term)));
    return { total: matches.length, entries: matches.slice(0, Math.max(1, Math.min(100, count))).map(({ hash, search, overhead, ...entry }) => entry) };
  }
  read(id) {
    return this.serial(async () => {
      if (!validId(id) || !this.entries.some(e => e.id === id)) throw new Error("记录已被删除。");
      const payload = decrypt(await fs.readFile(path.join(this.directory, id + ".bin")), this.key);
      const index = this.entries.findIndex(e => e.id === id);
      const [entry] = this.entries.splice(index, 1); entry.timestamp = Date.now(); this.entries.unshift(entry);
      await this.saveIndex();
      return payload;
    });
  }
  remove(id) {
    return this.serial(async () => {
      if (!validId(id)) throw new Error("无效记录。");
      this.entries = this.entries.filter(e => e.id !== id);
      await this.saveIndex();
      await fs.rm(path.join(this.directory, id + ".bin"), { force: true });
    });
  }
  clear() {
    return this.serial(async () => {
      this.entries = []; await this.saveIndex();
      const files = await fs.readdir(this.directory);
      await Promise.all(files.filter(f => validId(f.replace(/\.bin(?:\.tmp)?$/, "")) && /\.bin(?:\.tmp)?$/.test(f))
        .map(f => fs.rm(path.join(this.directory, f), { force: true })));
    });
  }
  configure(limit) {
    return this.serial(async () => { this.limit = Math.max(1, Math.min(1000, limit)); await this.prune(); });
  }
  flush() { return this.writes; }
}
module.exports = { ClipboardStore };
