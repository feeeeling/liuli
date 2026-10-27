const box = document.getElementById("selection");
const size = document.getElementById("size");
let start, rect;
document.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  document.body.setPointerCapture(event.pointerId);
  document.body.classList.add("selecting");
  box.hidden = size.hidden = false;
  draw(event);
});
function draw(event) {
  if (!start) return;
  const x = Math.max(0, Math.min(innerWidth, event.clientX));
  const y = Math.max(0, Math.min(innerHeight, event.clientY));
  rect = { x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
  Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}
document.addEventListener("pointermove", draw);
document.addEventListener("pointerup", async event => {
  if (!start) return;
  draw(event); start = undefined;
  if (rect.width < 4 || rect.height < 4) { box.hidden = size.hidden = true; document.body.classList.remove("selecting"); return; }
  try { await window.capture.select(rect); } catch { document.getElementById("hint").textContent = "截图失败，请 Esc 取消后重试"; }
});
document.addEventListener("keydown", event => { if (event.key === "Escape") void window.capture.cancel(); });
document.addEventListener("contextmenu", event => { event.preventDefault(); void window.capture.cancel(); });
window.capture.ready().then(() => { document.body.dataset.ready = "true"; });
