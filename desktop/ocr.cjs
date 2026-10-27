const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
async function recognize(image, { packaged = false, resourcesPath } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "liuli-ocr-"));
  try {
    const size = image.getSize();
    // Windows OCR has a 2600px limit. Preserve proportions for large monitors.
    if (Math.max(size.width, size.height) > 2500) image = image.resize({
      width: Math.round(size.width * 2500 / Math.max(size.width, size.height)),
      height: Math.round(size.height * 2500 / Math.max(size.width, size.height)), quality: "best" });
    const file = path.join(dir, "region.png");
    await fs.writeFile(file, image.toPNG());
    const script = packaged ? path.join(resourcesPath, "ocr.ps1") : path.join(__dirname, "native", "ocr.ps1");
    const powershell = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const { stdout } = await promisify(execFile)(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ImagePath", file],
      { windowsHide: true, timeout: 20_000, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    if (result.error) throw new Error(result.error);
    return result.text || "";
  } finally { await fs.rm(path.join(dir, "region.png"), { force: true }); await fs.rmdir(dir); }
}
module.exports = { recognize };
