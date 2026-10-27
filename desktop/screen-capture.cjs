const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, nativeImage } = require("electron");

async function capturePixels(rect) {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isSafeInteger) || rect.width < 1 || rect.height < 1 ||
      rect.width > 16384 || rect.height > 16384 || rect.width * rect.height > 33554432)
    throw new Error("截图区域过大或无效，请缩小选区。");
  const helper = app.isPackaged ? path.join(process.resourcesPath, "ScreenCapture.exe")
    : path.join(__dirname, "native", "bin", "ScreenCapture.exe");
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(helper, values.map(String), {
      windowsHide: true, timeout: 8000, maxBuffer: 192 * 1024 * 1024, encoding: "ascii",
    }));
  } catch (cause) { throw new Error("未能读取桌面选区，请重试。", { cause }); }
  const image = nativeImage.createFromBuffer(Buffer.from(stdout, "base64"));
  const size = image.getSize();
  if (image.isEmpty() || size.width !== rect.width || size.height !== rect.height)
    throw new Error("未能读取截图选区，请重试。");
  return image;
}
module.exports = { capturePixels };
