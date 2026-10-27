const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
  screen,
  utilityProcess,
  nativeTheme,
} = require("electron");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { consumeSSE } = require("./stream.cjs");
const { captureSelection } = require("./selection.cjs");
const { constrain, fromEdge, heightLimit } = require("./panel-bounds.cjs");
const { roundedRegion } = require("./window-appearance.cjs");
const { WindowChrome } = require("./window-chrome.cjs");
const { ClipboardHistory } = require("./clipboard-history.cjs");
const { ClipboardWindow } = require("./clipboard-window.cjs");
const { panelMenuTemplate } = require("./panel-menu.cjs");
const windowChrome = process.platform === "win32" ? new WindowChrome({ packaged: app.isPackaged, resourcesPath: process.resourcesPath }) : null;
module.exports.windowChrome = windowChrome;
const { captureRegion, cancelCapture } = require("./screenshot.cjs");
const { recognize } = require("./ocr.cjs");
const { unwrapLatex, splitTranslation } = require("./renderer/result-format.js");
const defaultShortcuts = { input: "Alt+A", clipboard: "Alt+D", screenshot: "Alt+S", ocr: "Alt+Shift+S", latex: "Alt+L", silent: "Alt+C", clipboardHistory: "Alt+V" };
let capturingScreen = false;
let history = [];
let historyWrites = Promise.resolve();

if (process.env.LIULI_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.LIULI_USER_DATA_DIR));
}

let window;
let settingsWindow;
let clipboardHistory;
let clipboardUI;
let tray;
let daemon;
let quitting = false;
let taskController;
let loginController;
let daemonUrl;
let daemonFailure;
let resolveDaemon;
let rejectDaemon;
let pinned = false;
let panelDialogOpen = false;
let preferenceWrites = Promise.resolve();
let capturingSelection = false;
let manualPanelSize;
let panelGesture;
let sizeWrites = Promise.resolve();
let nativeGlass = false;
let panelLayoutKey;
let panelShapeKey;
let panelMoveTimer;

function panelLayout(value) {
  const key = JSON.stringify(value);
  if (panelLayoutKey === key) return;
  panelLayoutKey = key;
  send(window, "layout", value);
}

function appearance() {
  return { nativeGlass, dark: nativeTheme.shouldUseDarkColors,
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    highContrast: nativeTheme.shouldUseHighContrastColors };
}
function applyPanelShape() {
  if (!window || window.isDestroyed() || panelGesture) return;
  const { width, height } = window.getBounds();
  const key = `${width}:${height}:${screen.getDisplayMatching(window.getBounds()).scaleFactor}`;
  if (panelShapeKey === key) return;
  panelShapeKey = key;
  window.setShape(roundedRegion(width, height));
  windowChrome?.round(window);
}
function applyAppearance() {
  // The Windows system Acrylic backdrop has its own rectangular compositor
  // surface, which can outlive a resize/region update around transparent corners.
  // Render the translucent material inside Chromium's antialiased card instead.
  nativeGlass = false;
  window.setBackgroundMaterial("none");
  settingsWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#252527" : "#f3f3f5");
  applyPanelShape();
  if (clipboardUI?.window && !clipboardUI.window.isDestroyed()) clipboardUI.window.setBackgroundMaterial("none");
  broadcast("appearance", appearance());
}
let preferences = {
  theme: "system",
  targetLang: "zh",
  hideOnBlur: true,
  wikiRoot: "",
  enhanceSilentOCR: true,
  clipboardEnabled: true,
  clipboardLimit: 500,
  shortcuts: { ...defaultShortcuts },
};
const token = randomUUID();
const ready = new Promise((resolve, reject) => {
  resolveDaemon = resolve;
  rejectDaemon = reject;
});
void ready.catch(() => {});
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "docs", "assets", "icon.png");

function show(command) {
  if (!window || window.isDestroyed()) return;
  if (!window.isVisible()) {
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    fitPanel(area);
    const bounds = window.getBounds();
    window.setPosition(
      Math.max(
        area.x + 12,
        Math.min(cursor.x + 18, area.x + area.width - bounds.width - 12),
      ),
      Math.max(
        area.y + 12,
        Math.min(cursor.y + 16, area.y + area.height - bounds.height - 12),
      ),
    );
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (command) window.webContents.send("liuli:command", command);
}

function setPanelSize(width, height) {
  // Windows pins min/max to the current size when resizable is false.
  // Lift that constraint only for this synchronous programmatic resize.
  const visible = window.isVisible();
  const wasResizable = window.isResizable();
  if (!wasResizable) window.setResizable(true);
  try { window.setSize(width, height); }
  finally { if (!wasResizable) window.setResizable(false); applyPanelShape(); if (!visible) window.hide(); }
}

function fitPanel(area) {
  const bounds = window.getBounds();
  const size = manualPanelSize ? constrain({ ...bounds, ...manualPanelSize }, area) : null;
  const width = size?.width || Math.min(420, area.width - 24);
  const maxHeight = heightLimit(size?.height, area);
  if (Math.abs(bounds.width - width) >= 3 || bounds.height > maxHeight + 2)
    setPanelSize(width, Math.min(bounds.height, maxHeight));
  panelLayout({ maxHeight, userSized: Boolean(size), liveResize: Boolean(panelGesture) });
  return maxHeight;
}

function persistPanelSize() {
  const saved = JSON.stringify(manualPanelSize || null);
  const pending = sizeWrites.then(() => fs.writeFile(path.join(app.getPath("userData"), "panel-size.json"), saved));
  sizeWrites = pending.catch(() => {});
  return pending;
}

function applyManualBounds(bounds, area, vertical = true) {
  const next = constrain(bounds, area);
  const current = window.getBounds();
  if (!["x", "y", "width", "height"].some(key => current[key] !== next[key])) return;
  manualPanelSize = { width: next.width, height: vertical ? next.height : manualPanelSize?.height || 640 };
  // A live gesture enables resizing once; position and size are one native update.
  if (panelGesture) { panelGesture.changed = true; window.setBounds(next); }
  else {
    window.setResizable(true);
    window.setBounds(next);
    window.setResizable(false);
    applyPanelShape();
    panelLayout({ maxHeight: heightLimit(manualPanelSize.height, area), userSized: true,
      liveResize: false, ...(vertical ? { heldHeight: next.height } : {}) });
  }
}

async function translateSelection() {
  if (capturingSelection) return;
  if (taskController || loginController) {
    show({ type: "notice", message: "请先完成当前任务。" });
    return;
  }
  capturingSelection = true;
  try {
    await clipboardHistory?.request("suspend", true).catch(() => {});
    if (quitting) return { ok: false, error: "已退出。" };
    const { text, method } = await captureSelection({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    if (!quitting) show({ type: "selection", text });
    return { ok: true, method };
  } catch (error) {
    if (!quitting) show({ type: "notice", message: error.killed
      ? "读取选中文字超时，请重试或使用粘贴文本。"
      : error.message });
    return { ok: false, error: error.message };
  } finally {
    await clipboardHistory?.request("suspend", false).catch(() => {});
    capturingSelection = false;
  }
}
module.exports.translateSelection = translateSelection;

function recordHistory(task, result) {
  if (!result.trim() || task.action && task.action !== "task") return;
  const split = task.mode === "ocr-translate" ? splitTranslation(result) : null;
  const entry = { id: randomUUID(), timestamp: new Date().toISOString(), mode: task.mode,
    source: split?.source || task.text || "", result: task.mode === "latex" ? unwrapLatex(result) : split?.translation || result,
    targetLang: task.targetLang || preferences.targetLang };
  if (history[0]?.source === entry.source && history[0]?.result === entry.result && history[0]?.mode === entry.mode) return;
  history.unshift(entry); history = history.slice(0, 40);
  const saved = JSON.stringify(history);
  historyWrites = historyWrites.then(() => fs.writeFile(path.join(app.getPath("userData"), "history.json"), saved)).catch(() => {});
  broadcast("history", history);
}

async function performTask(task, onEvent) {
  if (taskController || loginController) throw new Error("已有任务正在进行。");
  const controller = new AbortController();
  taskController = controller; publishState();
  const timer = setTimeout(() => controller.abort(), 300_000);
  let result = "";
  try {
    await consumeSSE(await api("/v1/task", task, controller.signal), event => {
      if (event.event === "delta") result += event.data.text;
      if (event.event === "done" && !result) result = event.data.text || "";
      onEvent?.(event);
    });
    recordHistory(task, result);
    return result;
  } finally { clearTimeout(timer); taskController = undefined; publishState(); }
}
async function clipboardFingerprint() {
  const hash = createHash("sha256");
  for (const item of await clipboard.read()) for (const type of [...item.types].sort()) {
    // OLE bookkeeping can vary even when the actual clipboard is unchanged.
    if (/format="(?:DataObject|Ole Private Data)"/.test(type)) continue;
    hash.update(type).update(Buffer.from(await (await item.getType(type)).arrayBuffer()));
  }
  return hash.digest("hex");
}
function notify(message) { if (tray) tray.displayBalloon({ title: "琉璃", content: message, noSound: true }); }
async function screenshotAction(action) {
  if (capturingScreen || capturingSelection) return;
  if (taskController || loginController) { show({ type: "notice", message: "请先完成当前任务。" }); return; }
  capturingScreen = true;
  const previousPanel = window.isVisible(), previousSettings = settingsWindow.isVisible();
  window.hide(); settingsWindow.hide();
  if (clipboardUI?.window && !clipboardUI.window.isDestroyed()) clipboardUI.window.hide();
  try {
    // Let our own windows leave the desktop before showing live selection.
    await new Promise(resolve => setTimeout(resolve, 50));
    const snapshot = await captureRegion();
    if (!snapshot) {
      if (previousSettings) settingsWindow.show();
      if (previousPanel) show();
      return;
    }
    const payload = imagePayload(snapshot);
    const beforeOCR = action === "silent" ? await clipboardFingerprint() : undefined;
    let draft = "", localError;
    if (action !== "latex") {
      try { draft = await recognize(snapshot, { packaged: app.isPackaged, resourcesPath: process.resourcesPath }); }
      catch (error) { localError = error; }
    }
    if (quitting) return;
    if (action === "silent") {
      let copied = false;
      if (draft.trim() && await clipboardFingerprint() === beforeOCR) {
        await clipboard.writeText(draft); copied = true; notify("已复制（本地 OCR）");
      }
      if (!preferences.enhanceSilentOCR) {
        if (!copied) notify(localError ? "本地 OCR 不可用，请启用模型精修或检查 Windows OCR 语言包。" : draft.trim() ? "剪贴板已改变，保留现有内容。" : "未识别到文字。");
        return;
      }
      const beforeEnhance = await clipboardFingerprint();
      const health = await json("/health");
      if (!health.ok || !health.vision) {
        if (!copied) notify("请先登录支持图片的模型，或关闭静默 OCR 模型精修。");
        return;
      }
      const result = await performTask({ mode: "ocr", text: draft || undefined, ...payload, targetLang: preferences.targetLang });
      if (result.trim() && await clipboardFingerprint() === beforeEnhance) { await clipboard.writeText(result); notify("已精修并复制"); }
      else if (result.trim()) notify("OCR 已完成；剪贴板已改变，保留现有内容。结果已存入历史。");
      return;
    }
    show({ type: "capture", mode: { screenshot: "ocr-translate", ocr: "ocr", latex: "latex" }[action], image: payload, text: draft });
  } catch (error) {
    if (quitting) return;
    if (action === "silent") notify(`OCR 失败：${error.message}`);
    else show({ type: "error", message: error.message });
  } finally { capturingScreen = false; }
}
function invokeAction(action) {
  if (action === "clipboardHistory") {
    if (capturingScreen || capturingSelection || panelGesture) return;
    return void clipboardUI?.show().catch(error => { if (!quitting) notify(error.message); });
  }
  if (action === "clipboard") return void translateSelection();
  if (action === "input") return show({ type: "input" });
  if (["screenshot", "ocr", "latex", "silent"].includes(action)) return void screenshotAction(action);
}
module.exports.screenshotAction = screenshotAction;

function send(target, channel, value) {
  if (target && !target.isDestroyed())
    target.webContents.send(`liuli:${channel}`, value);
}

function broadcast(channel, value) {
  for (const target of [window, settingsWindow]) send(target, channel, value);
  if (channel === "appearance") send(clipboardUI?.window, channel, value);
}
function clipboardStatus(status = clipboardHistory?.status) {
  return { count: 0, bytes: 0, available: false, error: "", ...status,
    enabled: preferences.clipboardEnabled,
    recording: Boolean(preferences.clipboardEnabled && status?.recording),
    limit: preferences.clipboardLimit,
    shortcut: preferences.shortcuts.clipboardHistory };
}
function publishClipboardStatus(status) {
  const value = clipboardStatus(status);
  send(settingsWindow, "clipboard-changed", value);
  clipboardUI?.changed(value);
}

function state() {
  return {
    preferences,
    pinned,
    taskRunning: Boolean(taskController),
    loginRunning: Boolean(loginController),
  };
}

function publishState() {
  broadcast("state", state());
}

async function showSettings(section = "general") {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  if (clipboardUI?.window && !clipboardUI.window.isDestroyed()) clipboardUI.window.hide();
  settingsWindow.show();
  settingsWindow.focus();
  send(settingsWindow, "command", { type: "section", section });
}

function bindShortcuts(shortcuts) {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [name, key] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(key, () => invokeAction(name))) {
      failed.push(key);
    }
  }
  if (failed.length) throw new Error(`快捷键 ${failed.join("、")} 已被其他程序占用，请换一个组合。`);
}

async function savePreferences(patch) {
  const next = {
    ...preferences,
    ...patch,
    shortcuts: { ...preferences.shortcuts, ...patch.shortcuts },
  };
  if (
    !["auto", "zh", "en", "ja", "ko", "fr", "de", "zh-TW"].includes(next.targetLang) ||
    typeof next.hideOnBlur !== "boolean" || typeof next.enhanceSilentOCR !== "boolean" ||
    typeof next.wikiRoot !== "string" || !["system", "light", "dark"].includes(next.theme)
    || typeof next.clipboardEnabled !== "boolean"
    || ![100, 500, 1000].includes(next.clipboardLimit)
  )
    throw new Error("设置值无效。");
  const keys = Object.values(next.shortcuts);
  if (
    keys.length !== Object.keys(defaultShortcuts).length ||
    Object.keys(next.shortcuts).some(key => !(key in defaultShortcuts)) ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !/^(?:(?:Alt|Control|Ctrl|Shift|Super|CommandOrControl)\+)+(?:[A-Z0-9]|F\d{1,2}|Space)$/i.test(
          key,
        ),
    ) ||
    new Set(keys.map(key => { const parts = key.toLowerCase().replace(/ctrl/g, "control").split("+"); const letter = parts.pop(); return parts.sort().join("+") + "+" + letter; })).size !== keys.length
  )
    throw new Error("请为各项操作设置不同的组合快捷键，例如 Alt+A。");
  const previous = preferences;
  const shortcutsChanged =
    JSON.stringify(next.shortcuts) !== JSON.stringify(previous.shortcuts);
  try {
    if (shortcutsChanged) bindShortcuts(next.shortcuts);
    await fs.writeFile(
      path.join(app.getPath("userData"), "preferences.json"),
      JSON.stringify(next),
    );
    preferences = next;
    if (previous.theme !== next.theme) {
      nativeTheme.themeSource = next.theme;
      applyAppearance();
    }
  } catch (error) {
    if (shortcutsChanged) {
      try {
        bindShortcuts(previous.shortcuts);
      } catch {}
    }
    throw error;
  }
  if (clipboardHistory && (previous.clipboardEnabled !== next.clipboardEnabled || previous.clipboardLimit !== next.clipboardLimit))
    await clipboardHistory.request("configure", { enabled: next.clipboardEnabled, limit: next.clipboardLimit }).catch(() => {});
  publishClipboardStatus();
  publishState();
  return state();
}

async function api(route, body, signal) {
  if (daemonFailure) throw new Error(daemonFailure);
  const base = await ready;
  if (daemonFailure) throw new Error(daemonFailure);
  return fetch(`${base}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(20_000),
  });
}

async function json(route, body) {
  const response = await api(route, body);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function handle(name, callback, roles = ["panel", "settings"]) {
  ipcMain.handle(`liuli:${name}`, (event, ...args) => {
    const owner =
      event.sender === window?.webContents
        ? window
        : event.sender === settingsWindow?.webContents
          ? settingsWindow
          : event.sender === clipboardUI?.window?.webContents ? clipboardUI.window : null;
    const role = owner === window ? "panel" : owner === settingsWindow ? "settings" : "clipboard";
    if (
      !owner ||
      event.senderFrame !== owner.webContents.mainFrame ||
      !roles.includes(role)
    )
      throw new Error("Invalid sender");
    return callback(...args);
  });
}

function imagePayload(image) {
  if (image.isEmpty())
    throw new Error("剪贴板里没有图片。请先按 Win+Shift+S 截图，再粘贴截图。");
  const png = image.toPNG();
  if (png.length > 12 * 1024 * 1024)
    throw new Error("图片过大，请选取较小区域（PNG 不超过 12 MB）。");
  return { imageBase64: png.toString("base64"), mimeType: "image/png" };
}

function popupPanelMenu(params = {}) {
  const template = panelMenuTemplate({ editable: params.isEditable, selectedText: params.selectionText,
    action: (action, value) => send(window, "command", { type: "panel-action", action, value }),
    capture: action => void screenshotAction(action), settings: () => void showSettings(),
    clipboard: () => invokeAction("clipboardHistory") });
  Menu.buildFromTemplate(template).popup({ window });
}

function registerIPC() {
  handle("panel-menu", () => popupPanelMenu(), ["panel"]);
  handle("state", () => state());
  handle("appearance", () => appearance(), ["panel", "settings", "clipboard"]);
  handle("clipboard-status", () => clipboardStatus(), ["panel", "settings", "clipboard"]);
  handle("clipboard-query", async query => {
    if (typeof query !== "string" || query.length > 1000) throw new Error("无效搜索内容。");
    const result = await clipboardHistory.request("query", query);
    clipboardUI.fit(result.entries.length);
    return { ...result, status: clipboardStatus(result.status) };
  }, ["clipboard"]);
  handle("clipboard-show", () => clipboardUI.show());
  handle("clipboard-hide", () => clipboardUI.hide(), ["clipboard"]);
  handle("clipboard-use", id => clipboardUI.use(id), ["clipboard"]);
  handle("clipboard-remove", id => clipboardHistory.request("remove", id), ["clipboard"]);
  handle("clipboard-clear", () => clipboardHistory.request("clear"), ["clipboard", "settings"]);
  handle("clipboard-recording", enabled => {
    if (typeof enabled !== "boolean") throw new Error("无效记录设置。");
    return savePreferences({ clipboardEnabled: enabled });
  }, ["clipboard", "settings"]);
  handle("capture", action => { if (!["screenshot", "ocr", "latex", "silent"].includes(action)) throw new Error("无效截图操作。"); return screenshotAction(action); });
  handle("history", () => history);
  handle("history-restore", id => {
    const entry = history.find(item => item.id === id);
    if (entry) show({ type: "history", entry });
  }, ["settings", "panel"]);
  handle("history-clear", async () => {
    history = []; await historyWrites;
    await fs.writeFile(path.join(app.getPath("userData"), "history.json"), "[]");
    broadcast("history", history);
  }, ["settings"]);
  handle("preferences", (patch) => {
    const pending = preferenceWrites.then(() => savePreferences(patch));
    preferenceWrites = pending.catch(() => {});
    return pending;
  }, ["settings"]);
  handle("show-settings", (section) => showSettings(section), ["panel", "settings", "clipboard"]);
  handle("show-panel", () => show({ type: "input" }));
  handle("hide-panel", () => window.hide(), ["panel"]);
  handle("close-settings", () => settingsWindow.close(), ["settings"]);
  handle("quit", () => app.quit(), ["settings"]);
  handle("panel-resize-start", (edge, cursor) => {
    if (!["move", "n", "s", "e", "w", "ne", "nw", "se", "sw"].includes(edge)) throw new Error("Invalid resize edge");
    if (!cursor || ![cursor.x, cursor.y].every(value => Number.isFinite(value) && Math.abs(value) < 1e7)) return;
    panelGesture = { edge, cursor, bounds: window.getBounds(),
      area: screen.getDisplayMatching(window.getBounds()).workArea };
    if (edge !== "move") {
      window.setResizable(true);
      window.setShape([]);
      panelShapeKey = undefined;
      panelLayout({ maxHeight: heightLimit(manualPanelSize?.height, panelGesture.area), userSized: true, liveResize: true });
    }
  }, ["panel"]);
  handle("panel-resize-drag", (cursor) => {
    if (!panelGesture) return;
    if (!cursor || ![cursor.x, cursor.y].every(value => Number.isFinite(value) && Math.abs(value) < 1e7)) return;
    const { bounds, edge, area } = panelGesture;
    if (edge === "move") {
      const x = Math.round(bounds.x + cursor.x - panelGesture.cursor.x);
      const y = Math.round(bounds.y + cursor.y - panelGesture.cursor.y);
      const current = window.getBounds();
      if (current.x !== x || current.y !== y) window.setPosition(x, y);
      return;
    }
    applyManualBounds(fromEdge(bounds, edge, { x: cursor.x - panelGesture.cursor.x, y: cursor.y - panelGesture.cursor.y }, area), area, /[ns]/.test(edge));
  }, ["panel"]);
  handle("panel-resize-end", () => {
    const gesture = panelGesture;
    panelGesture = undefined;
    if (gesture) {
      if (gesture.edge === "move") {
        const area = screen.getDisplayMatching(window.getBounds()).workArea;
        fitPanel(area);
        const b = window.getBounds(), next = constrain(b, area);
        if (next.x !== b.x || next.y !== b.y) window.setPosition(next.x, next.y);
        applyPanelShape();
        return;
      }
      window.setResizable(false);
      applyPanelShape();
      if (gesture.changed) panelLayout({ maxHeight: heightLimit(manualPanelSize?.height, gesture.area), userSized: true,
        liveResize: false, ...(/[ns]/.test(gesture.edge) ? { heldHeight: window.getBounds().height } : {}) });
      else fitPanel(gesture.area);
    }
    return persistPanelSize();
  }, ["panel"]);
  handle("panel-resize-step", (dx, dy) => {
    if (![dx, dy].every(value => Number.isFinite(value) && Math.abs(value) <= 50)) return;
    const bounds = window.getBounds();
    applyManualBounds({ ...bounds, width: (manualPanelSize?.width || bounds.width) + dx,
      height: bounds.height + dy }, screen.getDisplayMatching(bounds).workArea, dy !== 0);
    return persistPanelSize();
  }, ["panel"]);
  handle(
    "resize-panel",
    (height) => {
      if (!Number.isFinite(height) || panelGesture) return;
      const area = screen.getDisplayMatching(window.getBounds()).workArea;
      const bounds = window.getBounds();
      const nextHeight = Math.min(Math.max(Math.ceil(height), 140), heightLimit(manualPanelSize?.height, area));
      if (Math.abs(bounds.height - nextHeight) > 2)
        setPanelSize(Math.min(manualPanelSize?.width || 420, area.width - 24), nextHeight);
      const nextX = Math.max(area.x + 12, Math.min(bounds.x, area.x + area.width - bounds.width - 12));
      const nextY = Math.max(area.y + 12, Math.min(bounds.y, area.y + area.height - nextHeight - 12));
      if (nextX !== bounds.x || nextY !== bounds.y) window.setPosition(nextX, nextY);
    },
    ["panel"],
  );
  handle(
    "choose-wiki",
    async () => {
      const result = await dialog.showOpenDialog(settingsWindow, {
        properties: ["openDirectory"],
        title: "选择本地 Wiki 目录",
      });
      return result.canceled ? null : result.filePaths[0];
    },
    ["settings"],
  );
  handle("health", () => json("/health"));
  handle("providers", () => json("/v1/providers"));
  handle("models", () => json("/v1/models"));
  handle(
    "model",
    async (id) => {
      if (taskController || loginController)
        throw new Error("请先停止当前任务或完成登录。");
      if (typeof id !== "string" || !id) throw new Error("请选择模型。");
      const result = await json("/v1/model", { id });
      await fs.writeFile(
        path.join(app.getPath("userData"), "model.json"),
        JSON.stringify({ id }),
      );
      broadcast("changed");
      return result;
    },
    ["settings", "panel"],
  );
  handle(
    "task",
    ({ requestId, ...task }) => performTask(task, event => send(window, "task-event", { ...event, requestId })),
    ["panel"],
  );
  handle("abort", async () => {
    taskController?.abort();
    await json("/v1/abort", {});
  });
  handle(
    "login",
    async (login) => {
      if (taskController || loginController)
        throw new Error("已有任务正在进行。");
      const controller = new AbortController();
      loginController = controller;
      publishState();
      const timer = setTimeout(() => controller.abort(), 600_000);
      try {
        await consumeSSE(
          await api("/v1/auth/login", login, controller.signal),
          (event) => {
            send(settingsWindow, "login-event", event);
          },
        );
      } finally {
        clearTimeout(timer);
        loginController = undefined;
        publishState();
        broadcast("changed");
      }
    },
    ["settings"],
  );
  handle("cancel-login", async () => {
    loginController?.abort();
    await json("/v1/auth/cancel", {});
  });
  handle("answer", (id, value) => json("/v1/auth/answer", { id, value }));
  handle(
    "logout",
    async (providerId) => {
      if (taskController || loginController)
        throw new Error("请先停止当前任务或完成登录。");
      const result = await json("/v1/auth/logout", { providerId });
      broadcast("changed");
      return result;
    },
    ["settings"],
  );
  handle("clipboard-text", () => clipboard.readText());
  handle("clipboard-image", async () => {
    for (const item of await clipboard.read()) {
      const type = item.types.find((value) => value.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      if (blob.size > 12 * 1024 * 1024)
        throw new Error("图片文件不能超过 12 MB。");
      return imagePayload(
        nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())),
      );
    }
    throw new Error("剪贴板里没有图片。可按 Alt+S 框选截图，或复制图片后粘贴。");
  });
  handle("choose-image", async () => {
    panelDialogOpen = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "选择翻译 / OCR 图片",
        properties: ["openFile"],
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
        ],
      });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      if ((await fs.stat(file)).size > 12 * 1024 * 1024)
        throw new Error("图片文件不能超过 12 MB。");
      return imagePayload(nativeImage.createFromPath(file));
    } finally {
      panelDialogOpen = false;
      window.focus();
    }
  });
  handle("copy", (text) => {
    if (typeof text === "string") return clipboard.writeText(text);
  });
  handle(
    "pin",
    (value) => {
      pinned = Boolean(value);
      publishState();
      return pinned;
    },
    ["panel"],
  );
  handle("open-external", (value) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("仅支持 HTTP(S) 链接。");
    return shell.openExternal(url.href);
  });
}

async function startDaemon() {
  let preferred;
  try {
    preferred = JSON.parse(
      await fs.readFile(
        path.join(app.getPath("userData"), "model.json"),
        "utf8",
      ),
    ).id;
  } catch {}
  const daemonDir = app.isPackaged
    ? path.join(process.resourcesPath, "daemon")
    : path.join(__dirname, "..", "daemon");
  daemon = utilityProcess.fork(path.join(__dirname, "daemon-entry.cjs"), [], {
    cwd: daemonDir,
    stdio: "pipe",
    serviceName: "Liuli translation daemon",
    env: {
      ...process.env,
      LIULI_TOKEN: token,
      LIULI_PORT: "0",
      LIULI_DESKTOP_DAEMON: daemonDir,
      ...(preferred && !process.env.LIULI_MODEL
        ? { LIULI_MODEL: preferred }
        : {}),
    },
  });
  let logs = "";
  const startupTimer = setTimeout(() => {
    daemonFailure = "后端启动超时，请退出琉璃后重试。";
    rejectDaemon(new Error(daemonFailure));
  }, 90_000);
  for (const stream of [daemon.stdout, daemon.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk.toString()).slice(-8000);
      const match = logs.match(/\[liuli\] (http:\/\/127\.0\.0\.1:\d+)/);
      if (match && !daemonUrl) {
        daemonUrl = match[1];
        clearTimeout(startupTimer);
        resolveDaemon(daemonUrl);
      }
    });
  daemon.on("exit", (code) => {
    clearTimeout(startupTimer);
    if (quitting) return;
    daemonFailure = `翻译后端已退出（${code}），请退出琉璃后重新打开。`;
    console.error(logs);
    rejectDaemon(new Error(daemonFailure));
    window?.webContents.send("liuli:command", {
      type: "error",
      message: daemonFailure,
    });
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => void showSettings());
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("app.liuli.desktop");
      Menu.setApplicationMenu(null);
      try {
        const savedHistory = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "history.json"), "utf8"));
        if (Array.isArray(savedHistory)) history = savedHistory.filter(item => item && typeof item.source === "string" && typeof item.result === "string").slice(0, 40);
      } catch {}
      try {
        const saved = JSON.parse(
          await fs.readFile(
            path.join(app.getPath("userData"), "preferences.json"),
            "utf8",
          ),
        );
        preferences = {
          ...preferences,
          ...saved,
          shortcuts: { ...preferences.shortcuts, ...saved.shortcuts },
        };
      } catch {}
      if (!["system", "light", "dark"].includes(preferences.theme)) preferences.theme = "system";
      if (typeof preferences.clipboardEnabled !== "boolean") preferences.clipboardEnabled = true;
      if (![100, 500, 1000].includes(preferences.clipboardLimit)) preferences.clipboardLimit = 500;
      nativeTheme.themeSource = preferences.theme;
      try {
        const saved = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "panel-size.json"), "utf8"));
        if (saved && [saved.width, saved.height].every(value => Number.isFinite(value) && value > 0))
          manualPanelSize = { width: saved.width, height: saved.height };
      } catch {}
      settingsWindow = new BrowserWindow({
        title: "琉璃 · 设置",
        width: 640,
        height: 560,
        minWidth: 580,
        minHeight: 460,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#252527" : "#f3f3f5",
        icon: iconPath,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window = new BrowserWindow({
        title: "琉璃 Liuli",
        width: 420,
        height: 330,
        minWidth: 320,
        minHeight: 140,
        frame: false,
        transparent: true,
        thickFrame: false,
        hasShadow: false,
        roundedCorners: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#00000000",
        icon: iconPath,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      for (const target of [window, settingsWindow]) {
        target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        target.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        target.webContents.session.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        );
      }
      window.on("blur", () => {
        if (preferences.hideOnBlur && !pinned && !panelDialogOpen && !panelGesture)
          window.hide();
      });
      window.webContents.on("context-menu", (_event, params) => popupPanelMenu(params));
      window.on("moved", () => {
        clearTimeout(panelMoveTimer);
        if (window.isVisible() && !panelGesture) panelMoveTimer = setTimeout(() => {
          if (window.isDestroyed() || panelGesture) return;
          fitPanel(screen.getDisplayMatching(window.getBounds()).workArea);
          applyPanelShape();
        }, 100);
      });
      window.on("resize", applyPanelShape);
      window.on("show", applyPanelShape);
      screen.on("display-metrics-changed", () => fitPanel(screen.getDisplayMatching(window.getBounds()).workArea));
      window.on("close", (event) => {
        if (!quitting && tray) {
          event.preventDefault();
          window.hide();
        }
      });
      settingsWindow.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        loginController?.abort();
        send(settingsWindow, "command", { type: "clear-secrets" });
        settingsWindow.hide();
      });
      if (process.env.LIULI_CLIPBOARD_MONITOR !== "0") {
        clipboardHistory = new ClipboardHistory({ directory: path.join(app.getPath("userData"), "clipboard-history"),
          enabled: preferences.clipboardEnabled, limit: preferences.clipboardLimit, onChanged: publishClipboardStatus });
      }
      clipboardUI = new ClipboardWindow({ history: clipboardHistory,
        chrome: windowChrome, primaryWindows: () => [window, settingsWindow], quitting: () => quitting });
      module.exports.clipboardHistory = clipboardHistory;
      module.exports.clipboardUI = clipboardUI;
      registerIPC();
      applyAppearance();
      nativeTheme.on("updated", applyAppearance);
      tray = new Tray(
        nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
      );
      tray.setToolTip("琉璃 Liuli · 翻译与 OCR");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "输入翻译", click: () => show({ type: "input" }) },
          { label: "划词翻译", click: () => void translateSelection() },
          { label: "截图翻译", click: () => invokeAction("screenshot") },
          { label: "截图 OCR", click: () => invokeAction("ocr") },
          { label: "公式转 LaTeX", click: () => invokeAction("latex") },
          { label: "静默 OCR", click: () => invokeAction("silent") },
          { label: "剪贴板历史", click: () => invokeAction("clipboardHistory") },
          { type: "separator" },
          { label: "设置…", click: () => void showSettings() },
          { label: "退出", click: () => app.quit() },
        ]),
      );
      tray.on("click", () => tray.popUpContextMenu());
      module.exports.tray = tray;
      let shortcutWarning;
      try {
        bindShortcuts(preferences.shortcuts);
      } catch (error) {
        shortcutWarning = error.message;
      }
      await Promise.all([
        window.loadFile(path.join(__dirname, "renderer", "panel.html")),
        settingsWindow.loadFile(
          path.join(__dirname, "renderer", "settings.html"),
        ),
      ]);
      window.hide();
      settingsWindow.show();
      if (shortcutWarning)
        send(settingsWindow, "command", {
          type: "notice",
          message: shortcutWarning,
        });
      await startDaemon();
    })
    .catch((error) => {
      dialog.showErrorBox("琉璃启动失败", error.message);
      app.exit(1);
    });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearTimeout(panelMoveTimer);
    windowChrome?.close();
    cancelCapture();
    globalShortcut.unregisterAll();
    taskController?.abort();
    loginController?.abort();
    const timer = setTimeout(() => {
      daemon?.kill();
      void clipboardHistory?.worker?.terminate();
      app.exit(0);
    }, 3000);
    const daemonStopped = new Promise(resolve => {
      if (!daemon?.pid) return resolve();
      daemon.once("exit", resolve);
      try { daemon.postMessage("shutdown"); } catch { resolve(); }
    });
    void Promise.allSettled([daemonStopped, clipboardHistory?.close(), preferenceWrites, historyWrites, sizeWrites]).then(() => {
      clearTimeout(timer);
      app.exit(0);
    });
  });
}
