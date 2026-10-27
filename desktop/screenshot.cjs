const { BrowserWindow, desktopCapturer, screen, ipcMain } = require("electron");
const path = require("node:path");
const { cropBounds } = require("./capture-bounds.cjs");

let active;
function cancelCapture() { if (active?.finish) active.finish(null); else active = undefined; }
async function captureRegion() {
  if (active) return null;
  const session = { windows: new Map() };
  active = session;
  try {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: {
      width: Math.ceil(Math.max(...displays.map(d => d.size.width * d.scaleFactor))),
      height: Math.ceil(Math.max(...displays.map(d => d.size.height * d.scaleFactor))),
    } });
    if (active !== session) return null;
    return await new Promise((resolve, reject) => {
      session.finish = (result, error) => {
        if (active !== session) return;
        active = undefined;
        for (const { window } of session.windows.values()) if (!window.isDestroyed()) window.destroy();
        session.windows.clear();
        error ? reject(error) : resolve(result);
      };
      for (const display of displays) {
        const source = sources.find(s => s.display_id === String(display.id)) || (displays.length === 1 ? sources[0] : null);
        if (!source || source.thumbnail.isEmpty()) continue;
        const window = new BrowserWindow({ ...display.bounds, frame: false, show: false,
          movable: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
          backgroundColor: "#171719", enableLargerThanScreen: true,
          webPreferences: { preload: path.join(__dirname, "capture-preload.cjs"),
            nodeIntegration: false, contextIsolation: true, sandbox: true } });
        window.setAlwaysOnTop(true, "screen-saver");
        window.setMenu(null);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", event => event.preventDefault());
        session.windows.set(window.webContents.id, { window, display, image: source.thumbnail });
        window.on("closed", () => session.finish(null));
        window.loadFile(path.join(__dirname, "renderer", "capture.html")).catch(error => session.finish(null, error));
      }
      if (!session.windows.size) session.finish(null, new Error("未能获取屏幕图像，请重试。"));
    });
  } catch (error) {
    if (active === session) active = undefined;
    throw error;
  }
}
function own(event) {
  const entry = active?.windows.get(event.sender.id);
  if (!entry || event.senderFrame !== entry.window.webContents.mainFrame) throw new Error("Invalid sender");
  return entry;
}
ipcMain.handle("liuli:capture-ready", event => {
  const entry = own(event);
  entry.window.show();
  if (entry.display.id === screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id) entry.window.focus();
  return entry.image.toDataURL();
});
ipcMain.handle("liuli:capture-cancel", event => { own(event); cancelCapture(); });
ipcMain.handle("liuli:capture-select", (event, rect) => {
  const { display, image } = own(event);
  const crop = image.crop(cropBounds(rect, display.bounds, image.getSize()));
  active.finish(crop);
});
module.exports = { captureRegion, cancelCapture };
