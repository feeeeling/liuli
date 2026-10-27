const $ = id => document.getElementById(id);
const api = window.liuli;
let entries = [], selected = 0, generation = 0, timer, using = false, state, renderedQuery;
function fail(error) { $("error").textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, ""); $("error").hidden = false; }
function select(index) {
  selected = Math.max(0, Math.min(entries.length - 1, index));
  const rows = [...$("entries").children];
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle("selected", i === selected);
    rows[i].setAttribute("aria-selected", String(i === selected));
  }
  $("search").setAttribute("aria-activedescendant", entries.length ? `entry-${selected}` : "");
  rows[selected]?.scrollIntoView({ block: "nearest" });
}
function render(result, reset) {
  const previous = reset ? undefined : entries[selected]?.id;
  entries = result.entries; state = result.status;
  $("entries").replaceChildren();
  entries.forEach((entry, index) => {
    const row = document.createElement("button"); row.className = "entry"; row.id = `entry-${index}`;
    row.setAttribute("role", "option"); row.tabIndex = -1;
    const icon = document.createElement("span"); icon.className = "entry-icon";
    if (entry.type === "image" && entry.thumbnail) { const image = document.createElement("img"); image.src = `data:image/png;base64,${entry.thumbnail}`; image.alt = ""; icon.append(image); }
    else icon.textContent = entry.type === "image" ? "▧" : "T";
    const copy = document.createElement("span"); copy.className = "entry-copy";
    const preview = document.createElement("span"); preview.className = "entry-preview"; preview.textContent = entry.preview;
    const meta = document.createElement("div"); meta.className = "entry-meta";
    const date = new Date(entry.timestamp);
    meta.textContent = `${entry.source ? entry.source + " · " : ""}${date.toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    copy.append(preview, meta);
    row.append(icon, copy);
    if (index < 9) { const number = document.createElement("span"); number.className = "entry-number"; number.textContent = `Alt ${index + 1}`; row.append(number); }
    row.addEventListener("click", () => { select(index); void use(index); });
    row.addEventListener("pointermove", () => select(index));
    $("entries").append(row);
  });
  $("empty").hidden = entries.length > 0;
  $("entries").hidden = !entries.length;
  $("empty").textContent = $("search").value ? "没有匹配的记录" : state.error || "复制文字或图片后，会出现在这里";
  $("status").textContent = state.error || `${state.recording ? "监听中" : state.enabled ? "正在准备" : "已暂停"} · ${result.total} 条${result.total > entries.length ? `，显示前 ${entries.length} 条` : ""}`;
  $("pause").textContent = state.enabled ? "暂停记录" : "继续记录";
  $("enter-hint").textContent = "↵ 复制";
  select(Math.max(0, entries.findIndex(entry => entry.id === previous)));
}
async function refresh(reset = false) {
  const current = ++generation;
  const query = $("search").value;
  try {
    const result = await api.clipboardQuery(query);
    if (current === generation) { render(result, reset); renderedQuery = query; return true; }
  } catch (error) { if (current === generation) fail(error); }
  return false;
}
async function use(index) {
  if (using) return;
  using = true; $("error").hidden = true;
  try {
    // Enter can arrive before the debounce timer or the last search response.
    // Resolve the current query before choosing a record from the list.
    clearTimeout(timer);
    if (renderedQuery !== $("search").value && !await refresh(true)) return;
    if (index !== undefined) { if (!entries[index]) return; select(index); }
    if (entries[selected]) await api.clipboardUse(entries[selected].id);
  }
  catch (error) { fail(error); }
  finally { using = false; }
}
$("search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => void refresh(true), 35); });
$("close").addEventListener("click", () => void api.clipboardHide().catch(fail));
$("settings").addEventListener("click", () => void api.showSettings("clipboard").catch(fail));
$("pause").addEventListener("click", () => void api.clipboardRecording(!state?.enabled).then(refresh).catch(fail));
document.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); select(selected + (event.key === "ArrowDown" ? 1 : -1)); }
  if (event.key === "Enter" && !event.target.closest("button")) { event.preventDefault(); void use(); }
  if (event.key === "Escape") { event.preventDefault(); void api.clipboardHide().catch(fail); }
  if (event.ctrlKey && event.key === "Delete" && entries[selected]) { event.preventDefault(); void api.clipboardRemove(entries[selected].id).then(refresh).catch(fail); }
  if (event.altKey && /^[1-9]$/.test(event.key)) { event.preventDefault(); void use(Number(event.key) - 1); }
});
api.onCommand(command => { if (command.type === "clipboard-open") { $("search").value = ""; $("error").hidden = true; $("search").focus(); void refresh(true); } });
api.onClipboardChanged(() => void refresh());
void refresh();
