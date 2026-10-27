import { packager } from "@electron/packager";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { includeRuntimeFile } from "../runtime-files.cjs";
import { buildNative } from "./build-native.cjs";
import { buildRenderer } from "./build-renderer.cjs";
import { writeIcon } from "./create-icon.cjs";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(desktop, "..");
const stage = path.join(root, "dist", "desktop-runtime");
const daemon = path.join(stage, "daemon");
const metadata = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
const selectionHelper = buildNative();
buildRenderer();
if (process.platform !== "win32")
  throw new Error(
    "Build the Windows package on Windows so native dependencies match.",
  );
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(daemon, "dist"), { recursive: true });
const icon = path.join(stage, "icon.ico");
writeIcon(path.join(root, "docs", "assets", "icon.png"), icon);
await cp(
  path.join(root, "daemon", "dist", "index.mjs"),
  path.join(daemon, "dist", "index.mjs"),
);
await cp(
  path.join(root, "daemon", "package.json"),
  path.join(daemon, "package.json"),
);
await cp(
  path.join(root, "daemon", "node_modules"),
  path.join(daemon, "node_modules"),
  {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(
        path.join(root, "daemon", "node_modules"),
        source,
      );
      return includeRuntimeFile(rel, process.arch);
    },
  },
);
const outputs = await packager({
  dir: desktop,
  name: "Liuli",
  platform: "win32",
  arch: process.arch,
  electronVersion: metadata.devDependencies.electron,
  appVersion: metadata.version,
  appCopyright: "Liuli contributors",
  out: path.join(root, "dist"),
  overwrite: true,
  asar: true,
  icon,
  ignore: [/^[/\\](node_modules|scripts|test|native)([/\\]|$)/, /package-lock\.json$/],
  extraResource: [daemon, selectionHelper, path.join(desktop, "native", "bin", "WindowChrome.exe"), path.join(desktop, "native", "ocr.ps1"), path.join(root, "docs", "assets", "icon.png")],
  win32metadata: {
    CompanyName: "Liuli",
    FileDescription: "Liuli Translation",
    ProductName: "Liuli",
  },
});
for (const output of outputs) {
  await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE-Liuli.txt"));
  await writeFile(
    path.join(output, "使用说明.txt"),
    "琉璃 Liuli Windows\r\n\r\n双击 Liuli.exe 打开设置，请保留文件夹内全部文件。\r\n设置：通用、快捷键、模型、账号；凭证与本机 Pi 共用。\r\n通用 → 外观可选择跟随系统、浅色、深色，立即生效并记住选择。\r\nAlt+A 输入翻译；Alt+D 划词翻译（无需手动复制）。\r\nAlt+S 截图翻译；Alt+Shift+S 截图 OCR；Alt+L 公式转 LaTeX；Alt+C 静默 OCR。\r\n拖动框选区域，Esc 或右键取消。公式结果包含预览与可复制源码。\r\n卡片自动适配内容，边缘/右下角可拖动调整；记住宽度和高度上限。\r\nEsc 收起，图钉固定，更多菜单打开设置、图片及各项操作。\r\n关闭窗口后驻留托盘，托盘或设置中可退出。\r\n",
    "utf8",
  );
  console.log(`Windows app: ${path.join(output, "Liuli.exe")}`);
}
