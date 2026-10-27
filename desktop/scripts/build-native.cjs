const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function buildNative() {
  if (process.platform !== "win32") throw new Error("Windows selection capture must be built on Windows.");
  const framework = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
  const source = path.resolve(__dirname, "../native/SelectionCapture.cs");
  const output = path.resolve(__dirname, "../native/bin/SelectionCapture.exe");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync(path.join(framework, "csc.exe"), [
    "/nologo", "/target:exe", "/optimize+", `/out:${output}`,
    `/reference:${path.join(framework, "WPF", "UIAutomationClient.dll")}`,
    `/reference:${path.join(framework, "WPF", "UIAutomationTypes.dll")}`,
    `/reference:${path.join(framework, "WPF", "WindowsBase.dll")}`,
    "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
    "/reference:System.Web.Extensions.dll", source,
  ], { windowsHide: true, stdio: "pipe" });
  execFileSync(path.join(framework, "csc.exe"), [
    "/nologo", "/target:exe", "/optimize+", `/out:${path.join(path.dirname(output), "WindowChrome.exe")}`,
    "/reference:System.Web.Extensions.dll", path.resolve(__dirname, "../native/WindowChrome.cs"),
  ], { windowsHide: true, stdio: "pipe" });
  return output;
}
if (require.main === module) console.log(`Selection helper: ${buildNative()}`);
module.exports = { buildNative };
