const { BrowserWindow, screen, clipboard, ClipboardItem, app } = require("electron");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { roundedRegion } = require("./window-appearance.cjs");

class ClipboardWindow {
  constructor({ history, chrome, primaryWindows, quitting }) {
    this.history = history; this.chrome = chrome;
    this.primaryWindows = primaryWindows; this.quitting = quitting;
  }
  async create() {
    if (this.window && !this.window.isDestroyed()) return this.loading;
    this.window = new BrowserWindow({ title: "琉璃 · 剪贴板历史", width: 480, height: 520,
      frame: false, transparent: true, backgroundColor: "#00000000", thickFrame: false,
      hasShadow: false, roundedCorners: false, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false, contextIsolation: true, sandbox: true } });
    this.window.setMenu(null);
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", event => event.preventDefault());
    this.window.on("blur", () => { if (!this.using) this.window.hide(); });
    this.window.on("close", event => { if (!this.quitting()) { event.preventDefault(); void this.hide(); } });
    this.loading = this.window.loadFile(path.join(__dirname, "renderer", "clipboard.html"));
    await this.loading;
  }
  async show() {
    if (!this.history || this.quitting()) return;
    if (this.window?.isVisible()) return this.hide();
    if (this.opening) return;
    this.opening = true;
    try {
    // Remember before creating/focusing the popup. Opening history must not turn
    // a later paste into input to the popup or another window in this process.
    try { this.target = await this.history.request("foreground"); } catch { this.target = undefined; }
    if (this.quitting()) return;
    await this.create();
    const cursor = screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(cursor).workArea;
    const width = Math.min(480, area.width - 24), height = Math.min(this.contentHeight(this.history.status.count), area.height - 24);
    const x = Math.max(area.x + 12, Math.min(cursor.x + 12, area.x + area.width - width - 12));
    const y = Math.max(area.y + 12, Math.min(cursor.y + 12, area.y + area.height - height - 12));
    this.window.setResizable(true); this.window.setBounds({ x, y, width, height }); this.window.setResizable(false);
    this.window.setShape(roundedRegion(width, height)); this.chrome?.round(this.window);
    this.window.show(); this.window.focus();
    this.window.webContents.send("liuli:command", { type: "clipboard-open" });
    } finally { this.opening = false; }
  }
  contentHeight(count) { return Math.min(520, 124 + Math.max(1, Math.min(count, 7)) * 68); }
  fit(count) {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
    const bounds = this.window.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
    const height = Math.min(this.contentHeight(count), area.height - 24);
    const y = Math.max(area.y + 12, Math.min(bounds.y, area.y + area.height - height - 12));
    if (bounds.height === height && bounds.y === y) return;
    this.window.setResizable(true); this.window.setBounds({ ...bounds, y, height }); this.window.setResizable(false);
    this.window.setShape(roundedRegion(bounds.width, height)); this.chrome?.round(this.window);
  }
  async restore() {
    const target = this.target;
    if (!target || !/^[0-9]+$/.test(target.hwnd) || !Number.isInteger(target.pid) || !target.pid ||
        !this.window || this.window.isDestroyed() || this.quitting()) return { restored: false };
    for (const window of this.primaryWindows()) {
      if (!window || window.isDestroyed()) continue;
      const handle = window.getNativeWindowHandle();
      const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      if (hwnd === target.hwnd && !window.isVisible()) window.showInactive();
    }
    const handle = this.window.getNativeWindowHandle();
    const sender = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    const helper = app.isPackaged ? path.join(process.resourcesPath, "SelectionCapture.exe")
      : path.join(__dirname, "native", "bin", "SelectionCapture.exe");
    try {
      const { stdout } = await promisify(execFile)(helper, ["--restore", target.hwnd, String(target.pid), sender],
        { windowsHide: true, timeout: 3000, encoding: "utf8", maxBuffer: 4096 });
      return JSON.parse(stdout);
    } catch { return { restored: false }; }
  }
  async hide(restore = true) {
    if (!this.window || this.window.isDestroyed()) return;
    if (restore && this.window.isVisible()) await this.restore();
    if (!this.window.isDestroyed()) this.window.hide();
  }
  async use(id) {
    if (this.using) return;
    this.using = true;
    try {
      const payload = await this.history.request("read", id), formats = {};
      if (payload.text || !payload.html && !payload.pngBase64) formats["text/plain"] = new Blob([payload.text || ""], { type: "text/plain" });
      if (payload.html) formats["text/html"] = new Blob([payload.html], { type: "text/html" });
      if (payload.pngBase64) formats["image/png"] = new Blob([Buffer.from(payload.pngBase64, "base64")], { type: "image/png" });
      await clipboard.write([new ClipboardItem(formats)]);
      await this.restore();
      await this.hide(false);
      return { copied: true };
    } finally { this.using = false; }
  }
  changed(status) {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.webContents.send("liuli:clipboard-changed", status);
  }
}
module.exports = { ClipboardWindow };
