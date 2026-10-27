const { BrowserWindow, screen, ipcMain } = require("electron");
const path = require("node:path");
const { cropBounds } = require("./capture-bounds.cjs");
const pixels = require("./screen-capture.cjs");

let active;
function cancelCapture() { if (active?.finish) active.finish(null); }
async function captureRegion() {
  if (active) return null;
  const session = { windows: new Map(), capturing: false };
  active = session;
  return new Promise((resolve, reject) => {
    session.finish = (result, error) => {
      if (active !== session) return;
      active = undefined;
      for (const { window } of session.windows.values()) if (!window.isDestroyed()) window.destroy();
      session.windows.clear();
      error ? reject(error) : resolve(result);
    };
    try {
      for (const display of screen.getAllDisplays()) {
        const window = new BrowserWindow({ ...display.bounds, frame: false, show: false,
          transparent: true, backgroundColor: "#00000000", hasShadow: false, thickFrame: false,
          roundedCorners: false, movable: false, resizable: false, alwaysOnTop: true,
          skipTaskbar: true, enableLargerThanScreen: true,
          webPreferences: { preload: path.join(__dirname, "capture-preload.cjs"),
            nodeIntegration: false, contextIsolation: true, sandbox: true } });
        window.setAlwaysOnTop(true, "screen-saver");
        window.setMenu(null);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", event => event.preventDefault());
        session.windows.set(window.webContents.id, { window, display });
        window.on("closed", () => { if (!session.capturing) session.finish(null); });
        window.loadFile(path.join(__dirname, "renderer", "capture.html")).catch(error => session.finish(null, error));
      }
      if (!session.windows.size) session.finish(null, new Error("未找到可截图的显示器。"));
    } catch (error) { session.finish(null, error); }
  });
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
  return { live: true };
});
ipcMain.handle("liuli:capture-cancel", event => { own(event); cancelCapture(); });
ipcMain.handle("liuli:capture-select", async (event, rect) => {
  const { display } = own(event);
  const session = active;
  if (session.capturing) return;
  const crop = cropBounds(rect, display.bounds, display.size);
  const physical = screen.dipToScreenRect(null, {
    ...crop, x: display.bounds.x + crop.x, y: display.bounds.y + crop.y,
  });
  session.capturing = true;
  // Keep the selector's activation until pixels are read. Destroying a focused
  // full-screen window first can reorder the app underneath on Windows.
  for (const { window } of session.windows.values()) if (!window.isDestroyed()) {
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
  }
  try {
    const image = await pixels.capturePixels(physical);
    session.finish(image);
  } catch (error) { session.finish(null, error); }
});
module.exports = { captureRegion, cancelCapture };
