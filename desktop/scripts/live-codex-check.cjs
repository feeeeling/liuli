// Opt-in check against the user's existing Codex login. Never run as part of CI.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { _electron: electron } = require("playwright");
if (process.env.LIULI_LIVE_CHECK !== "1") throw new Error("Set LIULI_LIVE_CHECK=1 to test the existing account with generic translation text.");

const desktop = path.resolve(__dirname, "..");
const qa = path.resolve(desktop, "../dist/qa");
const executablePath = path.resolve(desktop, "../dist/Liuli-win32-x64/Liuli.exe");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.LIULI_USER_DATA_DIR;
delete env.LIULI_MODEL;
let application, settings, panel;
const report = { checkedAt: new Date().toISOString(), mode: process.env.LIULI_LIVE_RESIZE_ONLY === "1" ? "resize-only" : "full", calls: [] };
async function launch() {
  application = await electron.launch({ ...(process.env.LIULI_LIVE_SOURCE === "1" ? { args: [desktop] } : { executablePath, args: [] }), env, cwd: desktop, timeout: 30000 });
  await application.firstWindow();
  for (let i = 0; i < 100; i++) {
    settings = application.windows().find(p => p.url().endsWith("settings.html"));
    panel = application.windows().find(p => p.url().endsWith("panel.html"));
    if (settings && panel) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await settings.waitForFunction(() => document.getElementById("status").textContent === "已就绪", null, { timeout: 100000 });
}
async function selectModel(id) {
  await panel.evaluate(() => window.liuli.showSettings("models"));
  await settings.locator("#model").selectOption(id);
  await settings.waitForFunction(() => !document.getElementById("model").disabled);
  const health = await settings.evaluate(() => window.liuli.health());
  assert.equal(`${health.provider}/${health.model}`, id);
  await panel.waitForFunction(id => document.getElementById("model-label").value === id, `${health.provider}/${health.model}`);
}
async function finishTranslation(model) {
  await panel.waitForFunction(() => document.getElementById("stop").hidden &&
    (document.getElementById("result").textContent || !document.getElementById("error").hidden), null, { timeout: 120000 });
  const result = await panel.locator("#result").innerText();
  const error = await panel.locator("#error").innerText();
  report.calls.push({ model, result, error });
  console.log(JSON.stringify({ translation: report.calls.at(-1) }));
  return { result, error };
}
(async () => {
  try {
    await fs.mkdir(qa, { recursive: true });
    await launch();
    const catalog = await settings.evaluate(() => window.liuli.models());
    const codex = catalog.models.filter(m => m.provider === "openai-codex");
    report.available = codex.map(m => m.id);
    report.initial = catalog.current;
    console.log(JSON.stringify({ current: report.initial, codexModels: report.available, warning: catalog.warning }));
    assert.ok(codex.length, "No Codex models were loaded from the existing login");
    const selected = codex.find(m => m.id === "gpt-6.1-sol") || codex.find(m => `openai-codex/${m.id}` === catalog.current) || codex[0];
    const preferred = `openai-codex/${selected.id}`;
    const alternative = codex.find(m => m.id === "gpt-6-sol") || codex.find(m => m.id !== selected.id);
    if (alternative && process.env.LIULI_LIVE_RESIZE_ONLY !== "1") {
      const id = `openai-codex/${alternative.id}`;
      await selectModel(id);
      await settings.locator("#preview-panel").click();
      await panel.locator("#source").fill("The translation panel is ready.");
      await panel.locator("#translate").click();
      await finishTranslation(id);
    }
    await selectModel(preferred);
    await settings.screenshot({ path: path.join(qa, "codex-model-selection.png") });
    const prefs = await settings.evaluate(() => window.liuli.state());
    if (process.env.LIULI_LIVE_RESIZE_ONLY !== "1") {
    const fixtureFile = path.join(qa, "琉璃划词测试.txt");
    await fs.writeFile(fixtureFile, "A small window can make translation feel effortless.");
    const fixture = spawn("notepad.exe", [fixtureFile], { detached: true, stdio: "ignore" });
    fixture.unref();
    console.log(JSON.stringify({ nativeReady: true, shortcut: prefs.preferences.shortcuts.clipboard, model: preferred }));
    // The tester selects this test-owned text in Notepad and uses the actual OS shortcut.
    await panel.waitForFunction(() => document.getElementById("source").value === "A small window can make translation feel effortless.", null, { timeout: 180000 });
    const translated = await finishTranslation(preferred);
    assert.ok(translated.result && !translated.error, JSON.stringify(translated));
    await panel.screenshot({ path: path.join(qa, "codex-selection-translation.png") });
    } else {
      await settings.locator("#preview-panel").click();
      await panel.locator("#source").fill("A small window can make translation feel effortless.");
    }
    report.selected = preferred;
    panel.on("console", message => { if (message.text().startsWith("RESIZE_POINTER")) console.log(message.text()); });
    await panel.evaluate(() => {
      for (const type of ["pointerdown", "pointerup", "pointercancel"]) document.addEventListener(type,
        e => { if (type === "pointerup" && e.target.closest("[data-resize]")) window.nativeResizeFinished = true; console.log("RESIZE_POINTER " + JSON.stringify({ type, target: e.target.id || e.target.className, x: e.clientX, y: e.clientY })); }, true);
    });
    const initialPanelSize = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    console.log(JSON.stringify({ grip: await panel.locator("#resize-grip").boundingBox(), size: initialPanelSize }));
    console.log(JSON.stringify({ nativeResizeReady: true }));
    await panel.waitForFunction(() => window.nativeResizeFinished === true, null, { timeout: 600000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    await panel.evaluate(() => window.liuli.endPanelResize());
    report.manualSize = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(Math.abs(report.manualSize.width - initialPanelSize.width) >= 8,
      `Mouse drag must change the preferred width: ${JSON.stringify(report.manualSize)}`);
    await panel.screenshot({ path: path.join(qa, "codex-manual-size.png") });
    await application.close(); application = undefined;
    await launch();
    const health = await settings.evaluate(() => window.liuli.health());
    assert.equal(`${health.provider}/${health.model}`, preferred);
    await settings.locator("#preview-panel").click();
    await panel.waitForFunction(() => document.getElementById("panel").classList.contains("user-sized"));
    const restoredSize = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(Math.abs(restoredSize.width - report.manualSize.width) <= 4 && restoredSize.height < 340);
    report.sizePersistedAfterRestart = true;
    assert.equal(await panel.locator("#auto-size").count(), 0);
    report.persistedAfterRestart = true;
    console.log(JSON.stringify({ persistedAfterRestart: true, model: preferred }));
    await fs.writeFile(path.join(qa, "codex-live-check.json"), JSON.stringify(report, null, 2));
  } finally {
    if (application) await application.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
