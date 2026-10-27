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
let configuringModel = false, refreshGeneration = 0;
let shared = {
  preferences: { targetLang: "zh", wikiRoot: "" },
  pinned: false,
  taskRunning: false,
  loginRunning: false,
};
let preferencesKey;
let canContinueSession = false;
let renderAsLatex = false;
let activeRequestId;
let responseElement = $("primary-result");
function resetConversation() {
  $("conversation").replaceChildren();
  $("conversation").hidden = true;
  followupOpen = false;
  $("followup-form").hidden = true;
  $("panel").classList.remove("conversation-open");
  responseElement = $("primary-result");
}
function appendMessage(role, text = "", label = role === "user" ? "你" : "回答") {
  const row = document.createElement("section");
  row.className = `chat-message ${role}`;
  row.dataset.role = role;
  const heading = document.createElement("div");
  heading.className = "chat-label"; heading.textContent = label;
  const body = document.createElement("div");
  body.className = "chat-text"; body.textContent = text;
  row.append(heading, body); $("conversation").append(row);
  return body;
}
function conversationContext(source) {
  const messages = [...$("conversation").children].map(row =>
    `${row.dataset.role === "user" ? "用户" : "助手"}：\n${row.querySelector(".chat-text").textContent}`);
  return [`原文：\n${source}`, `结果：\n${$("primary-result").textContent}`, ...messages].join("\n\n");
}
function fitContent() { $("panel").classList.remove("held-height"); }

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
  const blocked = busy || stopping || configuringModel || shared.taskRunning || shared.loginRunning;
  $("translate").disabled = blocked || !health.ok;
  $("stop").hidden = !busy;
  $("explain").disabled = blocked || !hasResult;
  $("explain").hidden = blocked || !hasResult || followupOpen;
  $("model-label").disabled = blocked;
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
    preferencesKey = key;
  }
  updateControls();
}
async function refresh() {
  const generation = ++refreshGeneration;
  try {
    const [currentHealth, catalog] = await Promise.all([api.health(), api.models()]);
    if (generation !== refreshGeneration) return;
    health = currentHealth;
    $("status").textContent = health.ok ? "已就绪" : "未登录";
    $("status").classList.toggle("ready", health.ok);
    const select = $("model-label");
    select.replaceChildren();
    const groups = new Map();
    for (const model of catalog.models) {
      if (!groups.has(model.provider)) { const group = document.createElement("optgroup"); group.label = model.provider; groups.set(model.provider, group); select.append(group); }
      groups.get(model.provider).append(new Option(`${model.name}${model.vision ? " · 视觉" : ""}`, `${model.provider}/${model.id}`));
    }
    if (!catalog.models.length) select.append(new Option(health.ok ? health.model : "添加账号…", catalog.current || ""));
    select.append(new Option("设置…", "__settings__"));
    select.value = catalog.current || "";
    select.title = health.ok ? `${health.provider} / ${health.model} · 切换模型` : "选择模型或添加账号";
  } catch (error) {
    if (generation !== refreshGeneration) return;
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
  $("result-label").textContent = {
    translate: "译文",
    ocr: "识别结果",
    "ocr-translate": "原文与译文",
    latex: "LaTeX",
  }[mode];
  $("mode-label").textContent = { "ocr-translate": "图译", ocr: "OCR", latex: "LaTeX" }[mode] || "";
  $("mode-label").hidden = mode === "translate";
}
function capturedSource(value) {
  $("source").classList.toggle("captured", value);
  $("panel").classList.toggle("captured-view", value);
}
function setImage(value) {
  if (!value) return;
  fitContent();
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
  const text = window.resultFormat.unwrapLatex($("primary-result").textContent);
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
  fitContent();
  message("error", "");
  message("notice", "");
  if (!health.ok) {
    message("error", "请先在设置 → 账号中登录供应商。");
    return;
  }
  const source = $("source").value.trim();
  const context = action === "task" ? undefined : conversationContext(source);
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
    message("error", "当前模型不支持图片，请切换到视觉模型。");
    return;
  }
  busy = true;
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  cancelled = false;
  hasResult = action !== "task" && Boolean($("primary-result").textContent);
  renderAsLatex = mode === "latex" && action === "task";
  $("panel").classList.toggle("latex-view", mode === "latex");
  $("result-section").hidden = false;
  if (action === "task") {
    resetConversation();
    $("primary-result").textContent = "";
    $("formula-preview").hidden = $("formula-hint").hidden = true;
  } else {
    followupOpen = true;
    $("panel").classList.add("conversation-open");
    $("conversation").hidden = false;
    if (action === "followup") appendMessage("user", text);
    responseElement = appendMessage("assistant", "", action === "explain" ? "解释" : "回答");
    $("followup-form").hidden = false;
  }
  responseElement.classList.add("streaming-response");
  $("result").scrollTop = $("result").scrollHeight;
  updateControls();
  try {
    const completed = await api.task({
      requestId,
      mode,
      action,
      keepSession: action !== "task" && canContinueSession,
      context,
      text: action === "followup" ? text : source || undefined,
      ...(action === "task" ? image : undefined),
      targetLang: $("target").value,
      wikiRoot: shared.preferences.wikiRoot || undefined,
    });
    // The invoke response is authoritative even when queued stream events have
    // not reached a background renderer yet.
    if (!cancelled && typeof completed === "string") {
      const following = $("result").scrollHeight - $("result").scrollTop - $("result").clientHeight < 36;
      responseElement.textContent = completed;
      if (following) $("result").scrollTop = $("result").scrollHeight;
    }
    canContinueSession = !cancelled;
  } catch (error) {
    if (!cancelled) fail(error);
    else message("notice", "已停止生成。");
  } finally {
    activeRequestId = undefined;
    busy = false;
    responseElement.classList.remove("streaming-response");
    if (action !== "task" && !responseElement.textContent) responseElement.textContent = cancelled ? "已停止生成。" : "未生成回复，请重试。";
    if (action === "task" && !cancelled) {
      if (mode === "latex") { $("primary-result").textContent = window.resultFormat.unwrapLatex($("primary-result").textContent); renderFormula(true); }
      if (mode === "ocr-translate") {
        const split = window.resultFormat.splitTranslation($("primary-result").textContent);
        if (split) { if (split.source) $("source").value = split.source;
          $("primary-result").textContent = split.translation || $("primary-result").textContent;
          $("result-label").textContent = "译文"; capturedSource(true); resizeSource(); }
      }
    }
    hasResult = Boolean($("primary-result").textContent);
    $("followup-form").hidden = !followupOpen || !hasResult;
    if (followupOpen && hasResult) $("followup").focus();
    updateControls();
  }
}
api.onTask(({ event, data, requestId }) => {
  if (!busy || requestId !== activeRequestId) return;
  const result = $("result");
  const following = result.scrollHeight - result.scrollTop - result.clientHeight < 36;
  if (event === "delta") responseElement.textContent += data.text;
  if (event === "done" && !responseElement.textContent)
    responseElement.textContent = data.text;
  if (event === "error" && !cancelled) message("error", data.message);
  if (renderAsLatex) { clearTimeout(formulaTimer); formulaTimer = setTimeout(() => renderFormula(), 120); }
  if (following) result.scrollTop = result.scrollHeight;
});
api.onState(applyState);
api.onChanged(() => void refresh());
$("model-label").addEventListener("change", async () => {
  const id = $("model-label").value;
  if (id === "__settings__" || !id) { await refresh(); return api.showSettings(health.ok ? "models" : "accounts").catch(fail); }
  configuringModel = true; updateControls(); message("error", "");
  try { await api.setModel(id); }
  catch (error) { fail(error); }
  finally { await refresh(); configuringModel = false; updateControls(); }
});
$("hide-panel").addEventListener("click", () => api.hidePanel().catch(fail));
$("pin").addEventListener("click", () => api.pin(!shared.pinned).catch(fail));
$("source").addEventListener("input", () => { fitContent(); capturedSource(false); resizeSource(); updateControls(); });
$("copy-source").addEventListener("click", () => api.copy($("source").value).catch(fail));
$("retry").addEventListener("click", () => void run());
$("translate").addEventListener("click", () => void run());
$("explain").addEventListener("click", () => void run("explain"));
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
    await api.copy($("primary-result").textContent);
    $("copy").title = "已复制";
    setTimeout(() => { $("copy").title = "拷贝结果"; }, 1600);
  } catch (error) {
    fail(error);
  }
});
async function chooseImage() { try { setImage(await api.chooseImage()); } catch (error) { fail(error); } }
async function pasteImage() { try { setImage(await api.clipboardImage()); } catch (error) { fail(error); } }
$("remove-image").addEventListener("click", () => {
  fitContent();
  image = undefined;
  document.querySelector(".source-section").classList.remove("image-only");
  $("image-area").hidden = true;
  $("image-preview").removeAttribute("src");
});
function clearSource() {
  $("source").value = ""; $("remove-image").click(); fitContent(); capturedSource(false); resizeSource(); $("source").focus();
}
async function panelAction(action, value) {
  if (action === "mode") { if (!busy) setMode(value); }
  if (action === "choose-image") await chooseImage();
  if (action === "paste-image") await pasteImage();
  if (action === "clear") clearSource();
  if (action === "followup" && hasResult) { if (!followupOpen) await run("explain"); else $("followup").focus(); }
}
$("followup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("followup").value.trim();
  if (text && !busy) {
    $("followup").value = "";
    void run("followup", text);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); void api.panelMenu().catch(fail); }
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
    void pasteImage();
  }
});
document.addEventListener("paste", (event) => {
  if (
    [...(event.clipboardData?.items || [])].some((item) =>
      item.type.startsWith("image/"),
    )
  ) {
    event.preventDefault();
    void pasteImage();
  }
});
const initialized = (async () => {
  applyState(await api.state());
  await refresh();
})();
api.onCommand(async (command) => {
  if (command.type === "panel-action") { await panelAction(command.action, command.value); return; }
  if (command.type === "error" || command.type === "notice") {
    message(command.type, command.message);
    return;
  }
  fitContent();
  capturedSource(command.type !== "input");
  resizeSource();
  $("source").focus();
  if (command.type === "input") {
    if (busy || shared.taskRunning) return;
    canContinueSession = false; resetConversation(); $("primary-result").textContent = ""; hasResult = false;
    setMode("translate"); $("source").value = ""; $("remove-image").click();
    $("result-section").hidden = true; resizeSource(); updateControls(); return;
  }
  if (command.type === "history") {
    if (busy || shared.taskRunning) return;
    canContinueSession = false; resetConversation(); setMode(command.entry.mode); $("source").value = command.entry.source;
    $("remove-image").click(); $("primary-result").textContent = command.entry.result;
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
api.onLayout(({ maxHeight, userSized, liveResize, heldHeight }) => {
  $("panel").classList.toggle("user-sized", Boolean(userSized));
  $("panel").classList.toggle("live-resizing", Boolean(liveResize));
  if (Number.isFinite(heldHeight)) {
    document.documentElement.style.setProperty("--panel-held-height", `${heldHeight}px`);
    $("panel").classList.add("held-height");
  }
  const value = `${maxHeight}px`;
  if (document.documentElement.style.getPropertyValue("--panel-max-height") !== value) {
    document.documentElement.style.setProperty("--panel-max-height", value);
    resizeSource();
  }
  if (!liveResize) scheduleFit();
});
let resizePointer;
let resizeGeneration = 0;
let resizeFrame, resizePoint, resizeWriting = false;
let resizeWrite = Promise.resolve();
function scheduleDrag() {
  if (resizeFrame || resizeWriting || !resizePoint) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    void flushDrag().finally(() => { if (resizePointer !== undefined) scheduleDrag(); });
  });
}
function flushDrag() {
  if (!resizePoint) return resizeWrite;
  const point = resizePoint;
  resizePoint = undefined;
  resizeWriting = true;
  resizeWrite = resizeWrite.then(() => api.dragPanelResize(point)).catch(fail)
    .finally(() => { resizeWriting = false; });
  return resizeWrite;
}
for (const handle of document.querySelectorAll("[data-resize], .panel-header")) {
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    if (handle.classList.contains("panel-header") && event.target.closest("button")) return;
    event.preventDefault();
    resizePointer = event.pointerId;
    resizeGeneration++;
    handle.setPointerCapture(event.pointerId);
    resizePoint = undefined;
    const edge = handle.dataset.resize || "move";
    $("panel").classList.toggle("moving", edge === "move");
    resizeWrite = api.beginPanelResize(edge, { x: event.screenX, y: event.screenY }).catch(fail);
  });
  handle.addEventListener("pointermove", event => {
    if (resizePointer === event.pointerId) {
      resizePoint = { x: event.screenX, y: event.screenY };
      scheduleDrag();
    }
  });
  const end = async event => {
    if (resizePointer !== event.pointerId) return;
    const generation = resizeGeneration;
    resizePointer = undefined;
    if (event.type === "pointerup") resizePoint = { x: event.screenX, y: event.screenY };
    cancelAnimationFrame(resizeFrame);
    resizeFrame = undefined;
    await resizeWrite;
    if (generation !== resizeGeneration) return;
    await flushDrag();
    if (generation !== resizeGeneration) return;
    await api.endPanelResize().catch(fail);
    if (generation === resizeGeneration) $("panel").classList.remove("moving");
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
let fitFrame, previousFitHeight;
function scheduleFit() {
  if (fitFrame || $("panel").classList.contains("live-resizing")) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = undefined;
    if ($("panel").classList.contains("live-resizing")) return;
    const height = Math.ceil($("panel").getBoundingClientRect().height);
    if (height === previousFitHeight && Math.abs(innerHeight - height) <= 2) return;
    previousFitHeight = height;
    void api.resizePanel(height).catch(() => {});
  });
}
new ResizeObserver(() => {
  const content = document.querySelector(".card-content");
  content.classList.toggle("fitted", content.scrollHeight <= content.clientHeight + 3);
  const width = $("panel").getBoundingClientRect().width;
  if (width !== panelWidth) { panelWidth = width; resizeSource(); }
  scheduleFit();
}).observe($("panel"));
new ResizeObserver(() => {
  const content = document.querySelector(".card-content");
  content.classList.toggle("fitted", content.scrollHeight <= content.clientHeight + 3);
}).observe(document.querySelector(".card-content"));
