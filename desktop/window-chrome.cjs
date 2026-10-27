const { spawn } = require("node:child_process");
const path = require("node:path");
const { createInterface } = require("node:readline");
class WindowChrome {
  constructor({ packaged, resourcesPath }) {
    this.helper = packaged ? path.join(resourcesPath, "WindowChrome.exe") : path.join(__dirname, "native", "bin", "WindowChrome.exe");
    this.failed = false;
  }
  round(window, radius = 16) {
    if (this.failed || window.isDestroyed()) return false;
    if (!this.child) {
      this.child = spawn(this.helper, [String(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      this.child.on("error", () => { this.failed = true; });
      this.child.stdin.on("error", () => { this.failed = true; });
      createInterface({ input: this.child.stdout }).on("line", line => {
        try { this.state = JSON.parse(line); } catch { this.failed = true; }
      });
      this.child.on("exit", () => { this.failed = true; });
    }
    const handle = window.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    this.child.stdin.write(JSON.stringify({ hwnd, radius }) + "\n");
    return true;
  }
  close() { this.child?.stdin.end(); }
}
module.exports = { WindowChrome };
