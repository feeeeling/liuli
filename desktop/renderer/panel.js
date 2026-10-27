const $ = (id) => document.getElementById(id);
const api = window.liuli;
let mode = "translate",
  image,
  busy = false,
  stopping = false,
  cancelled = false,
  hasResult = false;
let followupOpen = false;
let health = { ok: false };
let shared = {
  preferences: { targetLang: "zh", wikiRoot: "" },
  pinned: false,
  taskRunning: false,
  loginRunning: false,
};
let preferencesKey;
let canContinueSession = false;
let renderAsLatex = false;

function message(id, text) {
  $(id).textContent = text || "";
  $(id).hidden = !text;
}
function fail(error) {
  message(
    "error",
    String(error.message || error).replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    ),
  );
}
function updateControls() {
  const blocked = busy || stopping || shared.taskRunning || shared.loginRunning;
  $("translate").disabled = blocked || !health.ok;
  $("stop").hidden = !busy;
  $("explain").disabled = blocked || !hasResult;
  $("followup-toggle").disabled = blocked || !hasResult;
  $("copy").disabled = !hasResult;
  $("copy-source").disabled = !$("source").value;
  $("retry").disabled = blocked || !hasResult;
  $("ask").disabled = blocked;
  $("pin").setAttribute("aria-pressed", String(shared.pinned));
  $("panel").classList.toggle("running", busy);
}
function applyState(value) {
  shared = value;
  const key = JSON.stringify(value.preferences);
  if (key !== preferencesKey) {
    $("target").value = value.preferences.targetLang;
    for (const button of document.querySelectorAll("[data-capture]")) {
      const shortcut = value.preferences.shortcuts?.[button.dataset.capture];
      if (button.querySelector("kbd")) button.querySelector("kbd").textContent = shortcut || "";
      else button.title = `截图翻译 · ${shortcut || ""}`;
    }
    preferencesKey = key;
  }
  updateControls();
}
async function refresh() {
  try {
    health = await api.health();
    $("status").textContent = health.ok ? "已就绪" : "未登录";
    $("status").classList.toggle("ready", health.ok);
    $("model-label").textContent = health.ok
      ? health.model
      : "在设置中添加账号";
    $("model-label").title = health.ok
      ? `${health.provider} / ${health.model} · 点击切换模型`
      : "打开账号设置";
  } catch (error) {
    fail(error);
    $("status").textContent = "连接失败";
  }
  updateControls();
}
function resizeSource() {
  $("source").style.height = "0px";
  $("source").style.height =
    `${Math.max($("source").classList.contains("captured") ? 22 : 48, Math.min($("source").scrollHeight, 96))}px`;
  $("source-count").textContent = $("source").value
    ? `${$("source").value.length} 字`
    : "";
}
function setMode(value) {
  mode = value;
  renderAsLatex = value === "latex";
  $("panel").classList.toggle("latex-view", value === "latex");
  $("panel").classList.toggle("ocr-view", value === "ocr");
  $("target").hidden = !["translate", "ocr-translate"].includes(value);
  $("formula-preview").hidden = $("formula-hint").hidden = true;
  for (const button of $("modes").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.mode === value));
  $("result-label").textContent = {
    translate: "译文",
    ocr: "识别结果",
    "ocr-translate": "原文与译文",
    latex: "LaTeX",
  }[mode];
  $("mode-label").textContent = { "ocr-translate": "图译", ocr: "OCR", latex: "LaTeX" }[mode] || "";
  $("mode-label").hidden = mode === "translate";
}
function setTools(open) {
  $("tools-content").hidden = !open;
  $("tools-toggle").setAttribute("aria-expanded", String(open));
}
function capturedSource(value) {
  $("source").classList.toggle("captured", value);
  $("panel").classList.toggle("captured-view", value);
}
function setImage(value) {
  if (!value) return;
  image = value;
  document.querySelector(".source-section").classList.toggle("image-only", !$("source").value.trim());
  $("image-preview").src = `data:${value.mimeType};base64,${value.imageBase64}`;
  $("image-area").hidden = false;
  if (mode === "translate") setMode("ocr-translate");
}
let formulaTimer;
function renderFormula(final = false) {
  clearTimeout(formulaTimer);
  if (mode !== "latex") return;
  const text = window.resultFormat.unwrapLatex($("result").textContent);
  $("formula-preview").hidden = !text;
  $("formula-hint").hidden = true;
  if (!text) return;
  try { window.katex.render(text, $("formula-preview"), { displayMode: true, throwOnError: true,
    trust: false, maxExpand: 1000, maxSize: 20, strict: "ignore", macros: {} }); }
  catch { $("formula-preview").hidden = true;
    if (final) message("formula-hint", "此公式暂时无法预览，仍可复制下方 LaTeX 源码。"); }
}
async function run(action = "task", text) {
  if (busy || stopping || shared.taskRunning || shared.loginRunning) return;
  message("error", "");
  message("notice", "");
  if (!health.ok) {
    message("error", "请先在设置 → 账号中登录供应商。");
    return;
  }
  const source = $("source").value.trim();
  const context = action === "task" ? undefined : `原文：\n${source}\n结果：\n${$("result").textContent}`;
  if (action === "task" && !source && !image) {
    message("error", "请输入文字或选择图片。");
    $("source").focus();
    return;
  }
  if (action === "task" && mode !== "translate" && !image) {
    message("error", "请粘贴截图或选择图片。");
    return;
  }
  if (action === "task" && image && !health.vision) {
    message("error", "当前模型不支持图片，请在设置中选择视觉模型。");
    return;
  }
  busy = true;
  cancelled = false;
  hasResult = false;
  renderAsLatex = mode === "latex" && action === "task";
  $("panel").classList.toggle("latex-view", renderAsLatex);
  $("result").textContent = "";
  $("formula-preview").hidden = $("formula-hint").hidden = true;
  $("result-section").hidden = false;
  if (action === "task") {
    followupOpen = false;
    $("followup-form").hidden = true;
  }
  if (action === "explain") {
    followupOpen = true;
    $("result-label").textContent = "解释";
  }
  updateControls();
  try {
    await api.task({
      mode,
      action,
      keepSession: action !== "task" && canContinueSession,
      context,
      text: action === "followup" ? text : source || undefined,
      ...(action === "task" ? image : undefined),
      targetLang: $("target").value,
      wikiRoot: shared.preferences.wikiRoot || undefined,
    });
    canContinueSession = !cancelled;
  } catch (error) {
    if (!cancelled) fail(error);
    else message("notice", "已停止生成。");
  } finally {
    busy = false;
    if (action === "task" && !cancelled) {
      if (mode === "latex") { $("result").textContent = window.resultFormat.unwrapLatex($("result").textContent); renderFormula(true); }
      if (mode === "ocr-translate") {
        const split = window.resultFormat.splitTranslation($("result").textContent);
        if (split) { if (split.source) $("source").value = split.source;
          $("result").textContent = split.translation || $("result").textContent;
          $("result-label").textContent = "译文"; capturedSource(true); resizeSource(); }
      }
    }
    hasResult = Boolean($("result").textContent);
    $("followup-form").hidden = !followupOpen || !hasResult;
    $("followup-toggle").setAttribute(
      "aria-expanded",
      String(followupOpen && hasResult),
    );
    updateControls();
  }
}
api.onTask(({ event, data }) => {
  const result = $("result");
  const following = result.scrollHeight - result.scrollTop - result.clientHeight < 36;
  if (event === "delta") $("result").textContent += data.text;
  if (event === "done" && !$("result").textContent)
    $("result").textContent = data.text;
  if (event === "error" && !cancelled) message("error", data.message);
  if (renderAsLatex) { clearTimeout(formulaTimer); formulaTimer = setTimeout(() => renderFormula(), 120); }
  if (following) result.scrollTop = result.scrollHeight;
});
api.onState(applyState);
api.onChanged(() => void refresh());
$("settings").addEventListener("click", () =>
  api.showSettings("general").catch(fail),
);
$("model-label").addEventListener("click", () =>
  api.showSettings(health.ok ? "models" : "accounts").catch(fail),
);
$("hide-panel").addEventListener("click", () => api.hidePanel().catch(fail));
$("pin").addEventListener("click", () => api.pin(!shared.pinned).catch(fail));
$("source").addEventListener("input", () => { capturedSource(false); resizeSource(); updateControls(); });
$("tools-toggle").addEventListener("click", () => setTools($("tools-content").hidden));
for (const button of document.querySelectorAll("[data-capture]"))
  button.addEventListener("click", () => { setTools(false); void api.capture(button.dataset.capture).catch(fail); });
$("copy-source").addEventListener("click", () => api.copy($("source").value).catch(fail));
$("retry").addEventListener("click", () => void run());
$("modes").addEventListener("click", (event) => {
  if (event.target.dataset.mode && !busy) setMode(event.target.dataset.mode);
});
$("translate").addEventListener("click", () => void run());
$("explain").addEventListener("click", () => void run("explain"));
$("followup-toggle").addEventListener("click", () => {
  followupOpen = !followupOpen;
  $("followup-form").hidden = !followupOpen;
  $("followup-toggle").setAttribute("aria-expanded", String(followupOpen));
  if (followupOpen) $("followup").focus();
});
$("stop").addEventListener("click", async () => {
  cancelled = true;
  stopping = true;
  updateControls();
  try {
    await api.abort();
  } catch (error) {
    fail(error);
  } finally {
    stopping = false;
    updateControls();
  }
});
$("copy").addEventListener("click", async () => {
  try {
    await api.copy($("result").textContent);
    $("copy").title = "已复制";
    setTimeout(() => { $("copy").title = "拷贝结果"; }, 1600);
  } catch (error) {
    fail(error);
  }
});
$("choose-image").addEventListener("click", async () => {
  try {
    setImage(await api.chooseImage());
  } catch (error) {
    fail(error);
  }
});
$("paste-image").addEventListener("click", async () => {
  try {
    setImage(await api.clipboardImage());
  } catch (error) {
    fail(error);
  }
});
$("remove-image").addEventListener("click", () => {
  image = undefined;
  document.querySelector(".source-section").classList.remove("image-only");
  $("image-area").hidden = true;
  $("image-preview").removeAttribute("src");
});
$("clear").addEventListener("click", () => {
  $("source").value = "";
  resizeSource();
  $("remove-image").click();
  setTools(false);
  capturedSource(false);
  resizeSource();
  $("source").focus();
});
$("paste-text").addEventListener("click", async () => {
  try {
    $("source").value = await api.clipboardText();
    resizeSource();
  } catch (error) {
    fail(error);
  }
});
$("followup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("followup").value.trim();
  if (text && !busy) {
    $("followup").value = "";
    void run("followup", text);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void api.hidePanel().catch(fail);
  }
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    void run();
  }
  if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
    event.preventDefault();
    $("paste-image").click();
  }
});
document.addEventListener("paste", (event) => {
  if (
    [...(event.clipboardData?.items || [])].some((item) =>
      item.type.startsWith("image/"),
    )
  ) {
    event.preventDefault();
    $("paste-image").click();
  }
});
const initialized = (async () => {
  applyState(await api.state());
  await refresh();
})();
api.onCommand(async (command) => {
  if (command.type === "error" || command.type === "notice") {
    message(command.type, command.message);
    return;
  }
  setTools(false);
  capturedSource(command.type !== "input");
  resizeSource();
  $("source").focus();
  if (command.type === "input") {
    if (busy || shared.taskRunning) return;
    canContinueSession = false; setMode("translate"); $("source").value = ""; $("remove-image").click();
    $("result-section").hidden = true; resizeSource(); updateControls(); return;
  }
  if (command.type === "history") {
    if (busy || shared.taskRunning) return;
    canContinueSession = false; setMode(command.entry.mode); $("source").value = command.entry.source;
    $("remove-image").click(); $("result").textContent = command.entry.result;
    hasResult = true; $("result-section").hidden = false; resizeSource(); renderFormula(true); updateControls(); return;
  }
  if (command.type === "capture") {
    await initialized;
    setMode(command.mode); $("source").value = command.text || "";
    setImage(command.image); resizeSource(); await run(); return;
  }
  if (!["clipboard", "selection"].includes(command.type)) return;
  await initialized;
  if (busy || shared.taskRunning || shared.loginRunning) {
    message("notice", "请先完成当前任务。");
    return;
  }
  try {
    $("source").value = command.type === "selection" ? command.text : await api.clipboardText();
    resizeSource();
    $("remove-image").click();
    setMode("translate");
    await run();
  } catch (error) {
    fail(error);
  }
});
api.onLayout(({ maxHeight, userSized, liveResize }) => {
  $("panel").classList.toggle("user-sized", Boolean(userSized));
  $("panel").classList.toggle("live-resizing", Boolean(liveResize));
  const value = `${maxHeight}px`;
  if (document.documentElement.style.getPropertyValue("--panel-max-height") !== value) {
    document.documentElement.style.setProperty("--panel-max-height", value);
    resizeSource();
  }
  requestAnimationFrame(() => void api.resizePanel($("panel").getBoundingClientRect().height).catch(() => {}));
});
let resizePointer;
for (const handle of document.querySelectorAll("[data-resize]")) {
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizePointer = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    void api.beginPanelResize(handle.dataset.resize, { x: event.screenX, y: event.screenY }).catch(fail);
  });
  handle.addEventListener("pointermove", event => {
    if (resizePointer === event.pointerId) void api.dragPanelResize({ x: event.screenX, y: event.screenY }).catch(fail);
  });
  const end = event => {
    if (resizePointer !== event.pointerId) return;
    resizePointer = undefined;
    void api.endPanelResize().catch(fail);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
}
$("resize-grip").addEventListener("keydown", event => {
  const amount = event.shiftKey ? 50 : 10;
  const step = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] }[event.key];
  if (step) {
    event.preventDefault();
    void api.stepPanelResize(...step).catch(fail);
  }
});
let panelWidth;
new ResizeObserver(() => {
  const content = document.querySelector(".card-content");
  content.classList.toggle("fitted", content.scrollHeight <= content.clientHeight + 3);
  const width = $("panel").getBoundingClientRect().width;
  if (width !== panelWidth) { panelWidth = width; resizeSource(); }
  void api
    .resizePanel($("panel").getBoundingClientRect().height)
    .catch(() => {});
}).observe($("panel"));
new ResizeObserver(() => {
  const content = document.querySelector(".card-content");
  content.classList.toggle("fitted", content.scrollHeight <= content.clientHeight + 3);
}).observe(document.querySelector(".card-content"));
