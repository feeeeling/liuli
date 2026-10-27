const $ = (id) => document.getElementById(id);
const api = window.liuli;
const shortcutNames = ["input", "clipboard", "screenshot", "ocr", "latex", "silent"];
let providers = [],
  pendingPrompt,
  configuringModel = false;
let activity = { taskRunning: false, loginRunning: false };
let preferencesKey;
let preferences;

function message(id, text) {
  $(id).textContent = text || "";
  $(id).hidden = !text;
}
function fail(error, account = false) {
  message(
    account ? "settings-error" : "error",
    String(error.message || error).replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    ),
  );
}
function setSection(name) {
  if (!["general", "models", "accounts", "shortcuts"].includes(name))
    name = "general";
  for (const section of document.querySelectorAll("[data-page]"))
    section.hidden = section.dataset.page !== name;
  for (const button of $("settings-nav").querySelectorAll("button")) {
    if (button.dataset.section === name)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
function updateControls() {
  const blocked =
    activity.taskRunning || activity.loginRunning || configuringModel;
  $("model").disabled = blocked || !$("model").value;
  $("refresh").disabled = blocked;
  $("login").disabled = blocked || !providers.length;
  $("provider").disabled = activity.loginRunning;
  $("auth-type").disabled = activity.loginRunning;
  $("cancel-login").hidden = !activity.loginRunning;
  $("logout").disabled =
    blocked ||
    !providers.find((item) => item.id === $("provider").value)?.configured;
}
function applyState(value) {
  activity = value;
  preferences = value.preferences;
  const key = JSON.stringify(preferences);
  if (key !== preferencesKey) {
    $("theme").value = preferences.theme;
    $("default-target").value = preferences.targetLang;
    $("hide-on-blur").checked = preferences.hideOnBlur;
    $("wiki-root").value = preferences.wikiRoot;
    for (const name of shortcutNames) $("shortcut-" + name).value = preferences.shortcuts[name];
    $("enhance-silent").checked = preferences.enhanceSilentOCR;
    preferencesKey = key;
  }
  updateControls();
}
async function save(patch) {
  message("error", "");
  try {
    applyState(await api.savePreferences(patch));
    $("save-state").textContent = "已保存";
    message("notice", "设置已保存。");
  } catch (error) {
    fail(error);
    if (preferences) applyState({ ...activity, preferences });
  }
}
async function refreshModels() {
  $("refresh").disabled = true;
  try {
    const health = await api.health();
    $("status").textContent = health.ok ? "已就绪" : "请先到账号页登录";
    $("status").classList.toggle("ready", health.ok);
    const catalog = await api.models();
    $("model").replaceChildren();
    for (const model of catalog.models) {
      const id = `${model.provider}/${model.id}`;
      const option = new Option(
        `${model.provider} / ${model.name}${model.vision ? " · 视觉" : ""}`,
        id,
      );
      option.selected = id === catalog.current;
      $("model").add(option);
    }
    if (!catalog.models.length)
      $("model").add(new Option("请先在账号页添加供应商", ""));
    $("catalog-warning").textContent = catalog.warning || "";
  } catch (error) {
    fail(error);
  } finally {
    updateControls();
  }
}
function updateProvider() {
  const provider = providers.find((item) => item.id === $("provider").value);
  $("auth-type").replaceChildren();
  for (const type of provider?.authTypes || [])
    $("auth-type").add(
      new Option(
        type === "oauth"
          ? provider.loginLabel || "浏览器登录（OAuth）"
          : "API Key",
        type,
      ),
    );
  $("provider-state").textContent = provider?.configured
    ? "已配置 · 可重新登录或退出此供应商"
    : "尚未配置";
  $("key-field").hidden = $("auth-type").value !== "api_key";
  updateControls();
}
async function loadProviders() {
  const previous = $("provider").value;
  providers = (await api.providers()).providers.filter(
    (item) => item.authTypes.length,
  );
  providers.sort(
    (a, b) =>
      Number(b.configured) - Number(a.configured) ||
      a.name.localeCompare(b.name),
  );
  $("provider").replaceChildren();
  for (const provider of providers)
    $("provider").add(
      new Option(
        `${provider.name}${provider.configured ? " ✓" : ""}`,
        provider.id,
      ),
    );
  if (providers.some((item) => item.id === previous))
    $("provider").value = previous;
  updateProvider();
}
api.onLogin(({ event, data }) => {
  if (event === "prompt") {
    pendingPrompt = data;
    $("prompt-label").textContent = data.message;
    $("prompt-value").value = "";
    $("prompt-value").type = data.type === "secret" ? "password" : "text";
    $("prompt-value").placeholder = data.placeholder || "";
    $("prompt-value").hidden = data.type === "select";
    $("prompt-select").hidden = data.type !== "select";
    $("prompt-select").replaceChildren();
    for (const option of data.options || [])
      $("prompt-select").add(new Option(option.label, option.id));
    $("prompt-form").hidden = false;
    (data.type === "select" ? $("prompt-select") : $("prompt-value")).focus();
  }
  const links = [...(data.links || [])];
  if (data.url) links.push({ url: data.url, label: "在浏览器中继续登录" });
  if (data.verificationUri)
    links.push({ url: data.verificationUri, label: "打开验证页面" });
  for (const link of links) {
    if (!/^https?:\/\//i.test(link.url)) continue;
    const button = document.createElement("button");
    button.textContent = link.label || "打开登录页面";
    button.addEventListener("click", () =>
      api.openExternal(link.url).catch((error) => fail(error, true)),
    );
    $("login-links").append(button);
  }
  if (data.message || data.instructions || data.userCode)
    $("login-state").textContent = [
      data.message,
      data.instructions,
      data.userCode,
    ]
      .filter(Boolean)
      .join("\n");
  if (event === "error") message("settings-error", data.message);
});
$("settings-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-section]");
  if (button) setSection(button.dataset.section);
});
$("go-accounts").addEventListener("click", () => setSection("accounts"));
$("preview-panel").addEventListener("click", () => api.showPanel().catch(fail));
$("quit").addEventListener("click", () => api.quit());
$("default-target").addEventListener("change", () =>
  save({ targetLang: $("default-target").value }),
);
$("hide-on-blur").addEventListener("change", () =>
  save({ hideOnBlur: $("hide-on-blur").checked }),
);
$("theme").addEventListener("change", () => save({ theme: $("theme").value }));
$("wiki-root").addEventListener("change", () =>
  save({ wikiRoot: $("wiki-root").value.trim() }),
);
$("choose-wiki").addEventListener("click", async () => {
  try {
    const root = await api.chooseWiki();
    if (root) await save({ wikiRoot: root });
  } catch (error) {
    fail(error);
  }
});
for (const id of shortcutNames.map(name => "shortcut-" + name))
  $(id).addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      event.target.blur();
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const modifiers = [
      event.ctrlKey && "Control",
      event.altKey && "Alt",
      event.shiftKey && "Shift",
      event.metaKey && "Super",
    ].filter(Boolean);
    const key = event.code.startsWith("Key")
      ? event.code.slice(3)
      : event.code.startsWith("Digit")
        ? event.code.slice(5)
        : event.code;
    if (modifiers.length && /^(?:[A-Z0-9]|F\d{1,2}|Space)$/.test(key))
      event.target.value = [...modifiers, key].join("+");
  });
$("save-shortcuts").addEventListener("click", () =>
  save({
    shortcuts: Object.fromEntries(shortcutNames.map(name => [name, $("shortcut-" + name).value])),
  }),
);
$("reset-shortcuts").addEventListener("click", () =>
  save({ shortcuts: { input: "Alt+A", clipboard: "Alt+D", screenshot: "Alt+S", ocr: "Alt+Shift+S", latex: "Alt+L", silent: "Alt+C" } }),
);
$("refresh").addEventListener("click", refreshModels);
$("model").addEventListener("change", async () => {
  configuringModel = true;
  updateControls();
  message("error", "");
  try {
    await api.setModel($("model").value);
  } catch (error) {
    fail(error);
  } finally {
    await refreshModels();
    configuringModel = false;
    updateControls();
  }
});
$("provider").addEventListener("change", updateProvider);
$("auth-type").addEventListener("change", () => {
  $("key-field").hidden = $("auth-type").value !== "api_key";
});
$("login").addEventListener("click", async () => {
  const apiKey = $("api-key").value.trim();
  if ($("auth-type").value === "api_key" && !apiKey) {
    message("settings-error", "请输入 API Key。");
    return;
  }
  activity.loginRunning = true;
  updateControls();
  message("settings-error", "");
  $("login-links").replaceChildren();
  $("login-state").textContent = "正在登录…";
  try {
    await api.login({
      providerId: $("provider").value,
      type: $("auth-type").value,
      apiKey: apiKey || undefined,
    });
    $("api-key").value = "";
    $("login-state").textContent = "登录成功。请到模型页选择模型。";
    await loadProviders();
    await refreshModels();
  } catch (error) {
    fail(error, true);
  } finally {
    activity.loginRunning = false;
    $("api-key").value = "";
    $("prompt-value").value = "";
    $("prompt-form").hidden = true;
    updateControls();
  }
});
$("cancel-login").addEventListener("click", () =>
  api.cancelLogin().catch((error) => fail(error, true)),
);
$("prompt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingPrompt) return;
  const value =
    pendingPrompt.type === "select"
      ? $("prompt-select").value
      : $("prompt-value").value;
  try {
    await api.answer(pendingPrompt.id, value);
    $("prompt-form").hidden = true;
    $("prompt-value").value = "";
  } catch (error) {
    fail(error, true);
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api.logout($("provider").value);
    await loadProviders();
    await refreshModels();
  } catch (error) {
    fail(error, true);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void api.closeSettings();
});
api.onState(applyState);
api.onChanged(() => {
  void refreshModels();
  void loadProviders().catch(fail);
});
api.onCommand((command) => {
  if (command.type === "section") setSection(command.section);
  if (command.type === "notice" || command.type === "error")
    message(command.type, command.message);
  if (command.type === "clear-secrets") {
    $("api-key").value = "";
    $("prompt-value").value = "";
    $("login-links").replaceChildren();
  }
});
void (async () => {
  applyState(await api.state());
  await Promise.all([refreshModels(), loadProviders()]);
})().catch(fail);

$("enhance-silent").addEventListener("change", () => save({ enhanceSilentOCR: $("enhance-silent").checked }));
function renderHistory(entries) {
  $("history-list").replaceChildren();
  for (const entry of entries) {
    const button = document.createElement("button");
    button.className = "history-entry";
    button.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${{translate:"翻译", "ocr-translate":"图译", ocr:"OCR", latex:"LaTeX"}[entry.mode] || "翻译"}\n${entry.result.slice(0,100)}`;
    button.addEventListener("click", () => api.restoreHistory(entry.id).catch(fail));
    $("history-list").append(button);
  }
  if (!entries.length) $("history-list").textContent = "暂无历史";
}
api.onHistory(renderHistory);
api.history().then(renderHistory).catch(fail);
$("clear-history").addEventListener("click", () => api.clearHistory().catch(fail));
