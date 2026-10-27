const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

async function captureSelection({ packaged = false, resourcesPath, copyOnly = false } = {}) {
  const helper = packaged
    ? path.join(resourcesPath, "SelectionCapture.exe")
    : path.join(__dirname, "native", "bin", "SelectionCapture.exe");
  const { stdout } = await promisify(execFile)(helper, copyOnly ? ["--copy-only"] : [], {
    windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf8",
  });
  const result = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  if (result.error) throw new Error(result.error);
  if (typeof result.text !== "string" || !result.text.trim())
    throw new Error("请先选中文字再按划词快捷键。");
  return result;
}
module.exports = { captureSelection };
