// Explicitly opt in: uses the existing local Pi/Codex account with generic fixtures.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
if (process.env.LIULI_LIVE_CHECK !== "1") throw new Error("Set LIULI_LIVE_CHECK=1 to test generic images with the existing login.");
const desktop = path.resolve(__dirname, "..");
const qa = path.resolve(desktop, "../dist/qa");
const env = { ...process.env, LIULI_USER_DATA_DIR: path.join(qa, "live-vision-profile") };
delete env.ELECTRON_RUN_AS_NODE; delete env.LIULI_MODEL;
let application;
(async () => {
  await fs.mkdir(qa, { recursive: true });
  try {
    application = await electron.launch({ args: [desktop], env, cwd: desktop });
    await application.firstWindow();
    let panel, settings;
    for (let i = 0; i < 200; i++) {
      panel = application.windows().find(p => p.url().endsWith("panel.html"));
      settings = application.windows().find(p => p.url().endsWith("settings.html"));
      if (panel && settings) break;
      await new Promise(r => setTimeout(r, 30));
    }
    await settings.waitForFunction(() => document.getElementById("status").textContent === "已就绪", null, { timeout: 100000 });
    const models = await settings.evaluate(() => window.liuli.models());
    assert.ok(models.models.some(m => m.provider === "openai-codex" && m.id === "gpt-6.1-sol" && m.vision));
    await settings.evaluate(() => window.liuli.setModel("openai-codex/gpt-6.1-sol"));
    await settings.evaluate(() => window.liuli.savePreferences({ targetLang: "zh" }));
    const fixture = await application.evaluateHandle(async ({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea;
      const w = new BrowserWindow({ x: area.x + 100, y: area.y + 100, width: 760, height: 300,
        frame: false, backgroundColor: "#ffffff", title: "Liuli Capture Fixture", alwaysOnTop: true });
      await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<title>Liuli Capture Fixture</title><body style="background:white;color:black;font:44px Arial;padding:24px;margin:0">Hello, Windows.<br><span style="font-size:64px">x² + y² = z²</span></body>'));
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("settings.html")).hide();
      w.show(); w.focus(); return w;
    });
    const report = { checkedAt: new Date().toISOString(), model: "openai-codex/gpt-6.1-sol", calls: [] };
    for (const [action, shortcut, dy, height] of [["screenshot", "Alt+S", 8, 95], ["latex", "Alt+L", 82, 116]]) {
      await fixture.evaluate(w => { w.show(); w.focus(); });
      console.log(JSON.stringify({ nativeHotkeyReady: action, shortcut }));
      let overlay;
      for (let i = 0; i < 1200; i++) {
        overlay = application.windows().find(p => p.url().endsWith("capture.html"));
        if (overlay) break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.ok(overlay, "Use the actual OS shortcut to start screenshot selection.");
      await overlay.waitForFunction(() => document.getElementById("screen").naturalWidth > 0);
      const bounds = await fixture.evaluate(w => w.getBounds());
      const origin = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
      const x = bounds.x - origin.x + 8, y = bounds.y - origin.y + dy;
      await overlay.mouse.move(x, y); await overlay.mouse.down();
      await overlay.mouse.move(x + 700, y + height, { steps: 16 });
      await overlay.mouse.up().catch(error => { if (!overlay.isClosed()) throw error; });
      await panel.waitForFunction(mode => document.getElementById("mode-label").textContent === (mode === "latex" ? "LaTeX" : "图译") &&
        document.getElementById("stop").hidden && (document.getElementById("result").textContent || !document.getElementById("error").hidden), action,
        { timeout: 150000 });
      const result = await panel.locator("#result").textContent();
      const error = await panel.locator("#error").textContent();
      assert.ok(result && !error, JSON.stringify({ action, result, error }));
      if (action === "latex") assert.ok(await panel.locator("#formula-preview .katex").count());
      report.calls.push({ action, shortcut, source: await panel.locator("#source").inputValue(), result });
      await panel.screenshot({ path: path.join(qa, `live-${action}.png`) });
      console.log(JSON.stringify(report.calls.at(-1)));
    }
    await fixture.evaluate(w => w.destroy()); await fixture.dispose();
    await fs.writeFile(path.join(qa, "vision-live-check.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ nativeAppearanceReady: true }));
    await new Promise(r => setTimeout(r, 45000));
  } finally { await application?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
