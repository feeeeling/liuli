const { app, safeStorage } = require("electron");
const { Worker } = require("node:worker_threads");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

class ClipboardHistory {
  constructor({ directory, enabled, limit, onChanged }) {
    this.status = { enabled, recording: false, available: false, count: 0, bytes: 0, limit, error: "" };
    this.pending = new Map(); this.serial = 0; this.onChanged = onChanged;
    this.ready = this.initialize(directory, enabled, limit).catch(() => {
      this.status.error = "剪贴板历史暂不可用。"; this.onChanged(this.status);
    });
  }
  async initialize(directory, enabled, limit) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("本机加密不可用。");
    await fs.mkdir(directory, { recursive: true });
    const keyFile = path.join(directory, "key.dat");
    let key;
    try {
      const decrypted = await safeStorage.decryptStringAsync(await fs.readFile(keyFile));
      key = Buffer.from(decrypted.result, "base64");
      if (decrypted.shouldReEncrypt) await fs.writeFile(keyFile, await safeStorage.encryptStringAsync(decrypted.result), { mode: 0o600 });
    }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      key = randomBytes(32);
      await fs.writeFile(keyFile, await safeStorage.encryptStringAsync(key.toString("base64")), { mode: 0o600, flag: "wx" });
    }
    const helper = app.isPackaged ? path.join(process.resourcesPath, "ClipboardMonitor.exe")
      : path.join(__dirname, "native", "bin", "ClipboardMonitor.exe");
    this.worker = new Worker(path.join(__dirname, "clipboard-worker.cjs"), { workerData: { directory, key, helper, enabled, limit } });
    key.fill(0);
    await new Promise((resolve, reject) => {
      this.worker.on("message", message => {
        if (message.type === "ready" || message.type === "changed") {
          this.status = message.status; this.onChanged(this.status);
          if (message.type === "ready") resolve();
        }
        if (message.type === "reply") {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id); clearTimeout(pending.timer);
            message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
          }
        }
      });
      this.worker.on("error", cause => {
        this.status = { ...this.status, available: false, recording: false, error: "剪贴板历史暂不可用。" };
        this.onChanged(this.status); reject(cause);
      });
      this.worker.on("exit", () => {
        this.worker = undefined;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("剪贴板历史已关闭。")); }
        this.pending.clear();
        reject(new Error("剪贴板历史已关闭。"));
      });
    });
  }
  async request(op, value) {
    await this.ready;
    if (!this.worker) throw new Error(this.status.error || "剪贴板历史尚未就绪。");
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("剪贴板操作超时。")); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, op, value });
    });
  }
  async close() {
    await this.ready;
    if (!this.worker) return;
    try { await this.request("shutdown"); }
    finally { await this.worker?.terminate(); }
  }
}
module.exports = { ClipboardHistory };
