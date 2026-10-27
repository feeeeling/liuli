const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { _electron: electron } = require("playwright");
const { closeElectron } = require("./electron-test.cjs");

const desktop = path.resolve(__dirname, "..");
const project = path.resolve(desktop, "..");

test(
  "Windows desktop translates, handles images, cancels, logs in and exits with its daemon",
  {
    timeout: 150_000,
  },
  async (t) => {
    if (process.env.LIULI_E2E_EXECUTABLE) {
      const { extractFile } = await import("@electron/asar");
      const archive = path.join(path.dirname(process.env.LIULI_E2E_EXECUTABLE), "resources", "app.asar");
      for (const file of ["clipboard-history.cjs", "clipboard-store.cjs", "clipboard-worker.cjs", "clipboard-window.cjs", "renderer/clipboard.html", "renderer/clipboard.js", "renderer/clipboard.css", "main.cjs", "preload.cjs", "selection.cjs", "panel-bounds.cjs", "window-appearance.cjs", "renderer/appearance.js", "renderer/panel.html", "renderer/panel.js",
        "renderer/panel.css", "renderer/settings.html", "renderer/settings.js", "renderer/settings.css", "renderer/common.css",
        "screenshot.cjs", "screen-capture.cjs", "capture-bounds.cjs", "capture-preload.cjs", "ocr.cjs", "window-chrome.cjs", "renderer/capture.html", "renderer/capture.js", "renderer/capture.css", "renderer/result-format.js", "renderer/vendor/katex/katex.min.js"]) {
        assert.ok(extractFile(archive, path.normalize(file)).equals(await fs.readFile(path.join(desktop, file))), `Packaged file is stale: ${file}`);
      }
      assert.ok((await fs.stat(path.join(path.dirname(archive), "ClipboardMonitor.exe"))).size > 0);
      assert.ok((await fs.stat(path.join(path.dirname(archive), "SelectionCapture.exe"))).size > 0);
      assert.ok((await fs.stat(path.join(path.dirname(archive), "WindowChrome.exe"))).size > 0);
      assert.ok((await fs.stat(path.join(path.dirname(archive), "ScreenCapture.exe"))).size > 0);
      assert.ok((await fs.readFile(path.join(path.dirname(archive), "ocr.ps1"))).equals(await fs.readFile(path.join(desktop, "native", "ocr.ps1"))));
      for (const file of ["renderer/vendor/katex/katex.min.css", "renderer/vendor/katex/fonts/KaTeX_Main-Regular.woff2"])
        assert.ok(extractFile(archive, path.normalize(file)).equals(await fs.readFile(path.join(desktop, file))));
    }
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "liuli-桌面 测试-"));
    const agentDir = path.join(home, ".pi", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(path.join(home, "Roaming"), { recursive: true });
    await fs.mkdir(path.join(home, "Local"), { recursive: true });
    const requests = [];
    const interactiveDesktop = !process.env.CI || process.env.LIULI_E2E_INTERACTIVE === "1";
    if (!interactiveDesktop) t.diagnostic("Hosted CI uses renderer-owned fixtures for selection/screen sources; native UIA, copy fallback and OS capture are checked on the interactive Windows desktop.");
    let cancelledRequest = false;
    let raceClipboard = false;
    const server = http.createServer(async (req, res) => {
      try {
        assert.equal(req.url, "/v1/chat/completions");
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        requests.push(body);
        const last = body.messages.at(-1).content;
        const prompt =
          typeof last === "string"
            ? last
            : last
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const send = (delta, finish = null) =>
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-liuli-local",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        if (prompt.includes("CANCEL_TEST")) {
          send({ role: "assistant", content: "开始生成" });
          const timer = setTimeout(() => res.end(), 30_000);
          res.on("close", () => {
            clearTimeout(timer);
            cancelledRequest = true;
          });
          return;
        }
        const hasImage =
          Array.isArray(last) && last.some((part) => part.type === "image_url");
        if (raceClipboard && hasImage) {
          raceClipboard = false;
          await application.evaluate(async ({ clipboard }) => clipboard.writeText("new user clipboard"));
        }
        const result = hasImage ? prompt.includes("数学公式") ? String.raw`$$\frac{x^{2}}{2}+\sqrt{y}=\sum_{i=1}^{n}i$$`
          : prompt.includes("<<<原文>>>") ? "<<<原文>>>\nHello world\n<<<译文>>>\n你好，世界。"
          : "截图识别结果：Hello world" : prompt.includes("LONG_LAYOUT_TEST")
          ? "让语言成为一座桥梁。长篇译文保留舒适行距，在卡片内部滚动，按钮与底部状态始终可见。\n\n".repeat(35)
          : "你好，世界。";
        send({ role: "assistant", content: result.slice(0, 3) });
        setTimeout(() => {
          send({ content: result.slice(3) });
          send({}, "stop");
          res.end("data: [DONE]\n\n");
        }, 30);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await fs.writeFile(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "liuli-test": {
            baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
            api: "openai-completions",
            apiKey: "local-test-placeholder",
            models: [
              { id: "vision", name: "本地测试模型", input: ["text", "image"] },
              { id: "text-only", name: "纯文本测试模型", input: ["text"] },
            ],
          },
        },
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY|ELECTRON_RUN_AS_NODE/i.test(
            key,
          ),
      ),
    );
    Object.assign(env, {
      LIULI_USER_DATA_DIR: path.join(home, "ui-profile"),
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
      LIULI_CLIPBOARD_MONITOR: "0",
      ELECTRON_ENABLE_LOGGING: "1",
      LIULI_MODEL: "liuli-test/vision",
      LIULI_PROXY_PORTS: "0",
      NO_PROXY: "*",
      no_proxy: "*",
    });
    await fs.mkdir(path.join(home, "ui-profile"), { recursive: true });
    await fs.writeFile(
      path.join(home, "ui-profile", "preferences.json"),
      JSON.stringify({
        targetLang: "zh",
        hideOnBlur: true,
        wikiRoot: "",
        shortcuts: { input: "Control+Alt+F11", clipboard: "Control+Alt+F12", screenshot: "Control+Alt+F1", ocr: "Control+Alt+F2", latex: "Control+Alt+F3", silent: "Control+Alt+F4", clipboardHistory: "Control+Alt+F5" },
      }),
    );
    let application;
    t.after(async () => {
      if (application) await closeElectron(application);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(home, { recursive: true, force: true });
    });
    application = await electron.launch({
      ...(process.env.LIULI_E2E_EXECUTABLE
        ? { executablePath: process.env.LIULI_E2E_EXECUTABLE, args: [] }
        : { args: [desktop] }),
      env,
      cwd: desktop,
      timeout: 30_000,
    });

    await application.firstWindow();
    await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });
    let settings, panel;
    for (let i = 0; i < 100; i++) {
      settings = application
        .windows()
        .find((page) => page.url().endsWith("settings.html"));
      panel = application
        .windows()
        .find((page) => page.url().endsWith("panel.html"));
      if (settings && panel) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(settings && panel, "settings and panel must be separate windows");
    const rendererErrors = [];
    for (const page of [panel, settings])
      page.on("pageerror", (error) => rendererErrors.push(error.message));
    let appLogs = "";
    application.process().stderr.on("data", (chunk) => {
      appLogs += chunk.toString();
    });
    try {
      await settings.waitForFunction(
        () => document.getElementById("status").textContent === "已就绪",
        null,
        { timeout: 100_000 },
      );
      await panel.waitForFunction(
        () => document.getElementById("status").textContent === "已就绪",
      );
    } catch (error) {
      t.diagnostic(await settings.locator("body").innerText());
      t.diagnostic(appLogs);
      throw error;
    }
    const panelVisible = () =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith("panel.html"))
          .isVisible(),
      );
    const waitPanel = async (visible) => {
      for (let i = 0; i < 60; i++) {
        if ((await panelVisible()) === visible) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(await panelVisible(), visible);
    };
    const openPanel = async () => {
      await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html")); w.show(); w.focus(); });
      await waitPanel(true);
    };
    const settlePanel = async () => {
      try {
        await panel.waitForFunction(() => Math.abs(document.getElementById("panel").getBoundingClientRect().height - innerHeight) <= 4, null, { timeout: 4000 });
        // Content fitting crosses renderer RAF and main-process IPC. A matching
        // intermediate frame does not yet make the resize grip's coordinates stable.
        await panel.evaluate(() => new Promise(resolve => {
          let previous, stable = 0;
          const frame = () => {
            const key = `${innerWidth}:${innerHeight}:${document.getElementById("panel").getBoundingClientRect().height}`;
            stable = key === previous ? stable + 1 : 0;
            previous = key;
            if (stable >= 6) resolve(); else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }));
      } catch (error) {
        t.diagnostic(JSON.stringify(await panel.evaluate(() => ({ width: innerWidth, height: innerHeight, max: getComputedStyle(document.documentElement).getPropertyValue("--panel-max-height"), elements: [...document.querySelectorAll("#panel, .source-section, #source, #result-section, #result, #followup-form, footer")].map(el => ({ id: el.id || el.className || el.tagName, height: el.getBoundingClientRect().height, display: getComputedStyle(el).display })) }))));
        t.diagnostic(JSON.stringify(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({title:w.getTitle(), bounds:w.getBounds(), content:w.getContentBounds(), min:w.getMinimumSize()})))));
        throw error;
      }
    };
    const openModels = async () => {
      await panel.locator("#model-label").click();
      await settings.locator('[data-section="models"]').click();
    };
    const openTools = async () => {
      if (await panel.locator("#tools-content").isHidden()) await panel.locator("#tools-toggle").click();
    };
    const openSettings = async () => { await openTools(); await panel.locator("#settings").click(); };
    assert.equal(
      await panelVisible(),
      false,
      "startup should open settings, not the floating card",
    );
    assert.equal(await application.evaluate(({ app }) => {
      const { tray } = process.mainModule.require(`${app.getAppPath()}/main.cjs`);
      let count = 0;
      const original = tray.popUpContextMenu;
      tray.popUpContextMenu = () => { count++; };
      try { tray.emit("click"); } finally { tray.popUpContextMenu = original; }
      return count;
    }), 1, "left clicking the tray must open its menu");
    assert.equal(await panelVisible(), false, "tray click must not open a floating card");
    assert.equal(await panel.locator("#provider").count(), 0);
    assert.equal(await panel.locator("#model").count(), 0);

    // Preferences live in settings and immediately reach the hidden panel.
    for (const theme of ["dark", "light", "system"]) {
      await settings.locator("#theme").selectOption(theme);
      await settings.waitForFunction(theme => window.liuli.state().then(s => s.preferences.theme === theme), theme);
      assert.equal(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource), theme);
      const expected = await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors ? "dark" : "light");
      for (const page of [settings, panel]) await page.waitForFunction(expected => document.documentElement.dataset.appearance === expected, expected);
    }
    await assert.rejects(settings.evaluate(() => window.liuli.savePreferences({ theme: "unknown" })), /设置值无效/);
    await settings.locator("#theme").selectOption("light");
    await settings.waitForFunction(() => document.documentElement.dataset.appearance === "light");
    await settings.locator("#default-target").selectOption("en");
    await panel.waitForFunction(
      () => document.getElementById("target").value === "en",
    );
    await settings.locator("#default-target").selectOption("zh");
    await panel.waitForFunction(
      () => document.getElementById("target").value === "zh",
    );
    await settings.evaluate(() => Promise.all([
      window.liuli.savePreferences({ targetLang: "en" }),
      window.liuli.savePreferences({ hideOnBlur: false }),
    ]));
    const concurrent = await settings.evaluate(() => window.liuli.state());
    assert.equal(concurrent.preferences.targetLang, "en");
    assert.equal(concurrent.preferences.hideOnBlur, false);
    await settings.evaluate(() => window.liuli.savePreferences({ targetLang: "zh", hideOnBlur: true }));
    await settings.locator('[data-section="shortcuts"]').click();
    await settings.locator("#shortcut-input").click();
    await settings.locator("#shortcut-input").press("Control+Alt+F9");
    await settings.locator("#save-shortcuts").click();
    await settings.waitForFunction(
      async () => (await window.liuli.state()).preferences.shortcuts.input === "Control+Alt+F9",
    );
    assert.equal(
      await application.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Control+Alt+F9"),
      ),
      true,
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(home, "ui-profile", "preferences.json"),
          "utf8",
        ),
      ).shortcuts.input,
      "Control+Alt+F9",
    );
    await settings.locator('[data-section="models"]').click();
    await settings.waitForFunction(
      () => document.getElementById("model").value === "liuli-test/vision",
    );
    await openPanel();
    await settlePanel();
    let chromeState;
    for (let i = 0; i < 100; i++) {
      chromeState = await application.evaluate(({ app, BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"));
        return { native: process.mainModule.require(`${app.getAppPath()}/main.cjs`).windowChrome?.state,
          bounds: window.getBounds(), scale: screen.getDisplayMatching(window.getBounds()).scaleFactor };
      });
      if (chromeState.native?.applied && Math.abs(chromeState.native.width - chromeState.bounds.width * chromeState.scale) <= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(chromeState.native?.applied && chromeState.native.clipped, JSON.stringify(chromeState));
    assert.ok(Math.abs(chromeState.native.width - chromeState.bounds.width * chromeState.scale) <= 2, JSON.stringify(chromeState));
    const bounds = await application.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("panel.html"),
      );
      return { outer: w.getBounds(), content: w.getContentBounds() };
    });
    assert.ok(bounds.outer.width <= 500);
    assert.ok(
      Math.abs(bounds.outer.height - bounds.content.height) <= 2,
      `floating card must have no native title bar (allowing DPI rounding): ${JSON.stringify(bounds)}`,
    );
    await assert.rejects(
      panel.evaluate(() => window.liuli.setModel("liuli-test/text-only")),
      /Invalid sender/,
    );

    // Hold the first task's stream IPC until after its invoke response. The
    // finished result must remain correct when those stale events are released.
    await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html")).webContents;
      contents.testSend = contents.send;
      contents.testHeld = [];
      contents.send = function(channel, ...args) {
        if (channel === "liuli:task-event") { this.testHeld.push([channel, ...args]); return; }
        return this.testSend.call(this, channel, ...args);
      };
    });
    await panel.locator("#source").fill("Hello world");
    await panel.locator("#translate").click();
    await panel.waitForFunction(
      () =>
        document.getElementById("result").textContent === "你好，世界。" &&
        document.getElementById("stop").hidden,
    );
    await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html")).webContents;
      contents.send = contents.testSend;
      for (const event of contents.testHeld) contents.send(...event);
      delete contents.testSend; delete contents.testHeld;
    });
    assert.equal(await panel.locator("#result").textContent(), "你好，世界。", "late stream IPC must not append to a finished result");
    await panel.locator("#copy").click();
    await panel.waitForFunction(() => document.getElementById("copy").title === "已复制");
    await panel.waitForFunction(expected => window.liuli.clipboardText().then(text => text === expected), "你好，世界。", { timeout: 5000 });
    assert.equal(
      await application.evaluate(({ clipboard }) => clipboard.readText()),
      "你好，世界。",
    );
    await panel.locator("#followup-toggle").click();
    await panel.locator("#followup").fill("解释一下这个词");
    await panel.locator("#followup").press("Enter");
    await panel.waitForFunction(() => document.getElementById("stop").hidden);
    assert.equal(requests.length, 2);
    assert.ok(
      requests[1].messages.some((message) => message.role === "assistant"),
    );
    await fs.mkdir(path.join(project, "dist", "qa"), { recursive: true });
    const suffix = process.env.LIULI_E2E_EXECUTABLE ? "packaged" : "source";
    await panel.screenshot({
      path: path.join(project, "dist", "qa", `floating-${suffix}.png`),
    });

    // A different window holds the selection. Capture must finish before the panel focuses.
    const fixturePage = application.waitForEvent("window");
    const fixtureWindow = await application.evaluateHandle(async ({ BrowserWindow, app }) => {
      app.setAccessibilitySupportEnabled(true);
      const fixture = new BrowserWindow({ width: 640, height: 400, title: "Liuli selection test",
        webPreferences: { nodeIntegration: false, contextIsolation: true } });
      fixture.selectionInputs = [];
      fixture.webContents.on("before-input-event", (_event, input) => fixture.selectionInputs.push({ key: input.key, type: input.type, control: input.control, alt: input.alt }));
      await fixture.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
        '<title>Liuli selection test</title><textarea id="text" style="width:90%;height:180px">Selected text without manual copying.</textarea><input id="password" type="password" value="dummy-test-value">'));
      fixture.show(); fixture.focus();
      return fixture;
    });
    const selectionPage = await fixturePage;
    const focusSelection = async (empty = false) => {
      await fixtureWindow.evaluate(w => { w.setAlwaysOnTop(true); w.show(); w.focus(); });
      await selectionPage.locator("#text").click();
      await selectionPage.locator("#text").evaluate((el, empty) => {
        el.focus(); el.setSelectionRange(0, empty ? 0 : el.value.length);
      }, empty);
      await new Promise(resolve => setTimeout(resolve, 150));
    };
    await application.evaluate(async ({ clipboard }) => clipboard.writeText("original clipboard sentinel"));
    await focusSelection();
    const selectionStatus = interactiveDesktop
      ? await application.evaluate(async ({ app }) => process.mainModule.require(`${app.getAppPath()}/main.cjs`).translateSelection())
      : await application.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"));
        w.show(); w.focus(); w.webContents.send("liuli:command", { type: "selection", text: "Selected text without manual copying." });
        return { ok: true };
      });
    assert.equal(selectionStatus?.ok, true, JSON.stringify(selectionStatus));
    await panel.waitForFunction(() => document.getElementById("source").value === "Selected text without manual copying." && document.getElementById("stop").hidden, null, { timeout: 5000 });
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), "original clipboard sentinel");
    assert.ok(JSON.stringify(requests.at(-1)).includes("Selected text without manual copying."));
    await settlePanel();
    const shortHeight = await panel.evaluate(() => innerHeight);
    assert.ok(shortHeight >= 180 && shortHeight <= 320, `Short card height: ${shortHeight}`);
    assert.equal(await panel.locator(".panel-brand, header img, #auto-size").count(), 0);
    assert.equal(await panel.locator("#tools-content").isHidden(), true);
    assert.deepEqual(await panel.evaluate(() => ({
      body: getComputedStyle(document.getElementById("source")).fontSize,
      result: getComputedStyle(document.getElementById("result")).fontSize,
      radius: getComputedStyle(document.getElementById("panel")).borderRadius,
    })), { body: "13px", result: "15px", radius: "16px" });
    await panel.screenshot({ path: path.join(project, "dist", "qa", `floating-short-${suffix}.png`) });
    await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "dark"; });
    await panel.emulateMedia({ colorScheme: "dark" });
    await panel.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--text").trim() === "#eeeeef");
    await panel.screenshot({ path: path.join(project, "dist", "qa", `floating-dark-${suffix}.png`) });
    await panel.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
    assert.equal(await panel.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
    await panel.emulateMedia({ forcedColors: "none", colorScheme: "light" });
    await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });

    if (interactiveDesktop) {
    // Force the copy fallback, including a rich clipboard, then check it was restored.
    await application.evaluate(async ({ clipboard, nativeImage, ClipboardItem }, file) => {
      const png = nativeImage.createFromPath(file).toPNG();
      await clipboard.write([new ClipboardItem({
        "text/plain": new Blob(["rich clipboard sentinel"], { type: "text/plain" }),
        "text/html": new Blob(["<b>rich clipboard sentinel</b>"], { type: "text/html" }),
        "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }),
      })]);
    }, path.join(project, "docs", "assets", "icon.png"));
    const clipboardSnapshot = () => application.evaluate(async ({ clipboard }) => {
      const formats = {};
      for (const item of await clipboard.read()) for (const type of item.types) {
        const blob = await item.getType(type);
        if (/^electron application\/osclipboard;format="(?:DataObject|Ole Private Data)"$/.test(type)) continue;
        formats[type] = process.mainModule.require("node:crypto").createHash("sha256")
          .update(Buffer.from(await blob.arrayBuffer())).digest("hex");
      }
      return formats;
    });
    const originalClipboard = await clipboardSnapshot();
    await focusSelection();
    const capture = (copyOnly) => application.evaluate(async ({ app }, copyOnly) =>
      process.mainModule.require(`${app.getAppPath()}/selection.cjs`).captureSelection({
        packaged: app.isPackaged, resourcesPath: process.resourcesPath, copyOnly,
      }), copyOnly);
    let copied;
    try { copied = await capture(true); }
    catch (error) {
      t.diagnostic(JSON.stringify(await fixtureWindow.evaluate(w => ({ inputs: w.selectionInputs, focused: w.isFocused() }))));
      t.diagnostic(JSON.stringify(await selectionPage.locator("#text").evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el }))));
      throw error;
    }
    assert.equal(copied.method, "copy");
    assert.equal(copied.text, "Selected text without manual copying.");
    assert.deepEqual(await clipboardSnapshot(), originalClipboard);
    // Repeat the native OLE round trip: private process-local formats must not
    // be restored alongside the user's text, HTML and image data.
    for (let attempt = 0; attempt < 3; attempt++) {
      await focusSelection();
      const repeated = await capture(true);
      assert.equal(repeated.text, "Selected text without manual copying.");
      assert.deepEqual(await clipboardSnapshot(), originalClipboard);
    }
    await focusSelection(true);
    await assert.rejects(capture(false), /未读取到选中文字/);
    assert.deepEqual(await clipboardSnapshot(), originalClipboard);
    await selectionPage.locator("#password").evaluate(el => { el.focus(); el.select(); });
    await assert.rejects(capture(false), /密码/);
    }
    await fixtureWindow.evaluate(w => w.destroy());
    await fixtureWindow.dispose();
    await openPanel();

    // Long input and output stay inside the monitor, with an independently scrolling result.
    await panel.locator("#source").fill("LONG_LAYOUT_TEST\n" + "A readable translation card. ".repeat(200));
    await panel.locator("#translate").click();
    await panel.waitForFunction(() => document.getElementById("result").textContent.length > 1000 && document.getElementById("stop").hidden);
    await settlePanel();
    const longLayout = await panel.evaluate(() => {
      const result = document.getElementById("result"), source = document.getElementById("source");
      return { height: innerHeight, scrolls: result.scrollHeight > result.clientHeight,
        sourceHeight: source.clientHeight, resultHeight: result.clientHeight,
        footerVisible: document.querySelector("footer").getBoundingClientRect().bottom <= innerHeight - 10,
        overflows: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(longLayout.height <= 644 && longLayout.height > shortHeight, JSON.stringify(longLayout));
    assert.ok(longLayout.scrolls && longLayout.footerVisible && !longLayout.overflows, JSON.stringify(longLayout));
    assert.ok(longLayout.resultHeight > longLayout.sourceHeight * 1.5, JSON.stringify(longLayout));
    await panel.screenshot({ path: path.join(project, "dist", "qa", `floating-long-${suffix}.png`) });
    // Simulate a small work area using the same renderer layout budget.
    await application.evaluate(({ BrowserWindow, screen }) => {
      screen.selectionTestOriginalDisplay = screen.getDisplayMatching;
      screen.getDisplayMatching = bounds => {
        const display = screen.selectionTestOriginalDisplay(bounds);
        return { ...display, workArea: { ...display.workArea, height: 464 } };
      };
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"))
        .webContents.send("liuli:layout", { maxHeight: 440 });
    });
    await panel.waitForFunction(() => document.getElementById("panel").getBoundingClientRect().height <= 440, null, { timeout: 5000 });
    assert.ok(await panel.evaluate(() => {
      const result = document.getElementById("result");
      return result.clientHeight > 40 && document.querySelector("footer").getBoundingClientRect().bottom <= 440;
    }));
    await application.evaluate(({ BrowserWindow, screen }) => {
      screen.getDisplayMatching = screen.selectionTestOriginalDisplay;
      delete screen.selectionTestOriginalDisplay;
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"))
        .webContents.send("liuli:layout", { maxHeight: 640 });
    });
    await panel.locator("#source").fill("Hello world");
    await panel.locator("#translate").click();
    await panel.waitForFunction(() => document.getElementById("stop").hidden);

    // Dragging sets width and a height limit. Content keeps fitting automatically.
    await panel.locator("#resize-grip").press("Shift+ArrowRight");
    await panel.locator("#resize-grip").press("Shift+ArrowDown");
    await panel.evaluate(() => window.liuli.endPanelResize());
    await panel.waitForFunction(() => document.getElementById("panel").classList.contains("user-sized") &&
      !document.getElementById("panel").classList.contains("live-resizing") && innerHeight < 340, null, { timeout: 5000 });
    const manual = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(manual.width >= 465 && manual.height < 340, JSON.stringify(manual));
    const savedSize = JSON.parse(await fs.readFile(path.join(home, "ui-profile", "panel-size.json"), "utf8"));
    assert.ok(Math.abs(savedSize.width - manual.width) <= 4 && Math.abs(savedSize.height - manual.height) <= 4,
      "resizing must retain the chosen height on release instead of snapping back");
    await panel.locator("#source").fill("LONG_LAYOUT_TEST\n" + "A readable translation card. ".repeat(200));
    await panel.locator("#translate").click();
    await panel.waitForFunction(() => document.getElementById("result").textContent.length > 1000 && document.getElementById("stop").hidden);
    await settlePanel();
    assert.ok(await panel.evaluate(() => innerHeight) > manual.height + 20);
    assert.ok(await panel.evaluate(() => innerHeight) > savedSize.height + 60, "long results should extend a manually preferred height before scrolling");
    assert.ok(await panel.evaluate(() => innerHeight) <= Math.min(savedSize.height + 180, 760) + 4);
    await panel.locator("#source").fill("A brief sentence.");
    await panel.locator("#translate").click();
    await panel.waitForFunction(() => document.getElementById("stop").hidden);
    await panel.waitForFunction(() => innerHeight < 340);
    assert.ok(Math.abs(await panel.evaluate(() => innerWidth) - manual.width) <= 4, "auto fitting must preserve the user's preferred width");
    await assert.rejects(settings.evaluate(() => window.liuli.stepPanelResize(50, 50)), /Invalid sender/);

    // Real window operations during a continuous drag: enable resizing once,
    // update bounds atomically, then restore its rounded region once on release.
    const beforeGesture = await application.evaluate(({ BrowserWindow, app }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"));
      w.gestureCounts = {};
      w.gestureOriginals = {};
      for (const name of ["setResizable", "setBounds", "setPosition", "setShape"]) {
        w.gestureOriginals[name] = w[name];
        w[name] = function(...args) {
          this.gestureCounts[name] = (this.gestureCounts[name] || 0) + 1;
          return this.gestureOriginals[name].apply(this, args);
        };
      }
      const chrome = process.mainModule.require(`${app.getAppPath()}/main.cjs`).windowChrome;
      chrome.gestureOriginal = chrome.round;
      chrome.gestureRounds = 0;
      chrome.round = function(...args) { this.gestureRounds++; return this.gestureOriginal(...args); };
      return w.getBounds();
    });
    await panel.evaluate(() => window.liuli.beginPanelResize("e", { x: 0, y: 0 }));
    for (let i = 1; i <= 40; i++) await panel.evaluate(x => window.liuli.dragPanelResize({ x, y: 0 }), i * 2);
    const duringGesture = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().endsWith("panel.html")).getBounds());
    assert.ok(Math.abs(duringGesture.height - beforeGesture.height) <= 4, "horizontal resizing must not jump in height");
    await panel.evaluate(() => window.liuli.endPanelResize());
    const gestureStats = await application.evaluate(({ BrowserWindow, app }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html"));
      const chrome = process.mainModule.require(`${app.getAppPath()}/main.cjs`).windowChrome;
      const stats = { ...w.gestureCounts, round: chrome.gestureRounds };
      for (const name in w.gestureOriginals) w[name] = w.gestureOriginals[name];
      delete w.gestureOriginals; delete w.gestureCounts;
      chrome.round = chrome.gestureOriginal;
      delete chrome.gestureOriginal; delete chrome.gestureRounds;
      return stats;
    });
    t.diagnostic(`40 drag updates: ${JSON.stringify(gestureStats)}`);
    assert.ok(gestureStats.setResizable <= 2 && gestureStats.round <= 2, JSON.stringify(gestureStats));
    assert.equal(gestureStats.setPosition || 0, 0, "bounds must update atomically instead of moving and resizing separately");
    assert.ok(Math.abs(duringGesture.width - beforeGesture.width - 80) <= 4);
    await settlePanel();
    const pointerStart = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const grip = await panel.locator("#resize-grip").boundingBox();
    await panel.mouse.move(grip.x + 5, grip.y + 5);
    await panel.mouse.down();
    await panel.mouse.move(grip.x - 45, grip.y - 25, { steps: 40 });
    await panel.mouse.up();
    await panel.waitForFunction(() => document.getElementById("panel").classList.contains("held-height") &&
      !document.getElementById("panel").classList.contains("live-resizing"));
    await settlePanel();
    const pointerEnd = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(Math.abs(pointerEnd.width - (pointerStart.width - 50)) <= 5, JSON.stringify({ pointerStart, pointerEnd }));
    assert.ok(Math.abs(pointerEnd.height - (pointerStart.height - 30)) <= 5, JSON.stringify({ pointerStart, pointerEnd }));
    const moveStart = await application.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("panel.html")).getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return { bounds, dx: bounds.x + bounds.width + 32 < area.x + area.width ? 20 : -20,
        dy: bounds.y + bounds.height + 32 < area.y + area.height ? 20 : -20 };
    });
    await panel.evaluate(() => window.liuli.beginPanelResize("move", { x: 0, y: 0 }));
    await panel.evaluate(({ dx, dy }) => window.liuli.dragPanelResize({ x: dx, y: dy }), moveStart);
    await panel.evaluate(() => window.liuli.endPanelResize());
    const moveEnd = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().endsWith("panel.html")).getBounds());
    assert.deepEqual(moveEnd, { ...moveStart.bounds, x: moveStart.bounds.x + moveStart.dx,
      y: moveStart.bounds.y + moveStart.dy }, "moving the card must preserve its dimensions");
    await panel.locator("#source").fill("A new sentence after resizing.");
    await panel.waitForFunction(() => !document.getElementById("panel").classList.contains("held-height"));

    await application.evaluate(
      async ({ clipboard, nativeImage, ClipboardItem }, file) => {
        const png = nativeImage.createFromPath(file).toPNG();
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }),
          }),
        ]);
      },
      path.join(project, "docs", "assets", "icon.png"),
    );
    await openTools();
    await panel.locator("#paste-image").click();
    await panel.locator("#image-area").waitFor({ state: "visible" });
    await openModels();
    await waitPanel(false);
    await settings.locator("#model").selectOption("liuli-test/text-only");
    await settings.waitForFunction(
      () => !document.getElementById("model").disabled,
    );
    await panel.waitForFunction(
      () => document.getElementById("model-label").textContent === "text-only",
    );
    await openPanel();
    await panel.locator("#translate").click();
    assert.match(await panel.locator("#error").textContent(), /不支持图片/);
    await openModels();
    await settings.locator("#model").selectOption("liuli-test/vision");
    await settings.waitForFunction(
      () => !document.getElementById("model").disabled,
    );
    await panel.waitForFunction(
      () => document.getElementById("model-label").textContent === "vision",
    );
    await openPanel();
    await openTools();
    await panel.locator('[data-mode="ocr"]').click();
    await panel.locator("#translate").click();
    await panel.waitForFunction(
      () =>
        document
          .getElementById("result")
          .textContent.includes("截图识别结果") &&
        document.getElementById("stop").hidden,
    );
    assert.ok(
      requests
        .at(-1)
        .messages.at(-1)
        .content.some(
          (part) =>
            part.type === "image_url" &&
            part.image_url.url.startsWith("data:image/png;base64,"),
        ),
    );

    // Pin survives focus changes; normal cards hide on blur; Esc always hides.
    // Native screen capture + real Windows OCR over an app-owned text fixture.
    const captureFixture = await application.evaluateHandle(({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea;
      const fixture = new BrowserWindow({ x: area.x + 60, y: area.y + 60, width: 800, height: 360,
        frame: false, alwaysOnTop: true, backgroundColor: "#ffffff" });
      fixture.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<html><body style="margin:32px;background:white;color:black;font:64px Arial">Hello world<br><span style="font-size:48px">x² + y² = z²</span></body></html>'));
      return fixture;
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    const captureFixtureBounds = await captureFixture.evaluate(w => w.getBounds());
    await captureFixture.evaluate(async (fixture, interactive) => {
        const electron = process.mainModule.require("electron");
        const pixels = process.mainModule.require(`${electron.app.getAppPath()}/screen-capture.cjs`);
        const original = pixels.capturePixels;
        pixels.calls = [];
        pixels.capturePixels = async rect => {
          pixels.calls.push(rect);
          const selectors = electron.BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith("capture.html"));
          if (selectors.some(w => w.getOpacity() !== 0)) throw new Error("Selection overlay must be transparent before reading desktop pixels");
          if (interactive) return original(rect);
          const bounds = electron.screen.dipToScreenRect(fixture, fixture.getBounds());
          const image = (await fixture.webContents.capturePage()).resize({ width: bounds.width, height: bounds.height });
          return image.crop({ ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y });
        };
        electron.desktopCapturer.getSources = async () => { throw new Error("Direct desktop selection must not capture a full-screen thumbnail"); };
      }, interactiveDesktop);
    const beginCapture = async action => {
      await captureFixture.evaluate(w => { w.setAlwaysOnTop(true); w.show(); w.focus(); });
      await panel.evaluate(action => { window.captureJob = window.liuli.capture(action); }, action);
      let overlay;
      for (let i = 0; i < 200; i++) {
        overlay = application.windows().find(page => page.url().endsWith("capture.html"));
        if (overlay) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(overlay, "native screenshot selector must open");
      await overlay.waitForFunction(() => document.body.dataset.ready === "true");
      assert.equal(await overlay.locator("img").count(), 0, "selection must show the live desktop, not a frozen screenshot");
      return overlay;
    };
    const selectFixture = async (overlay, reverse = false) => {
      const origin = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
      const left = captureFixtureBounds.x - origin.x + 12, top = captureFixtureBounds.y - origin.y + 12;
      const a = { x: left, y: top }, b = { x: left + 740, y: top + 230 };
      await overlay.mouse.move(...Object.values(reverse ? b : a));
      await overlay.mouse.down();
      await overlay.mouse.move(...Object.values(reverse ? a : b), { steps: 12 });
      await overlay.mouse.up().catch(error => { if (!overlay.isClosed()) throw error; });
      await panel.evaluate(() => window.captureJob);
    };
    const beforeCancel = requests.length;
    let overlay = await beginCapture("screenshot");
    await overlay.keyboard.press("Escape").catch(error => { if (!overlay.isClosed()) throw error; });
    await panel.evaluate(() => window.captureJob);
    assert.equal(requests.length, beforeCancel);
    assert.equal(await application.evaluate(({ app }) => process.mainModule.require(`${app.getAppPath()}/screen-capture.cjs`).calls.length), 0, "cancel must not read any screen pixels");
    overlay = await beginCapture("screenshot");
    await selectFixture(overlay, true);
    const actualCapture = await application.evaluate(({ app }) => process.mainModule.require(`${app.getAppPath()}/screen-capture.cjs`).calls[0]);
    const expectedCapture = await application.evaluate(({ screen }, bounds) => screen.dipToScreenRect(null, {
      x: bounds.x + 12, y: bounds.y + 12, width: 740, height: 230,
    }), captureFixtureBounds);
    assert.deepEqual(actualCapture, expectedCapture, "native capture must receive only the selected physical-pixel rectangle");
    await panel.waitForFunction(() => document.getElementById("result").textContent === "你好，世界。" && document.getElementById("stop").hidden);
    assert.equal(await panel.locator("#source").inputValue(), "Hello world");
    const localOCRAvailable = JSON.stringify(requests.at(-1)).includes("本地 OCR 草稿");
    assert.ok(localOCRAvailable || !interactiveDesktop, "real local OCR draft must reach the model");
    if (!localOCRAvailable) t.diagnostic("No local OCR draft from this hosted fixture; vision fallback remains covered and native OCR is checked on the interactive desktop.");
    assert.equal(await panel.locator("#result-label").textContent(), "译文");
    await panel.screenshot({ path: path.join(project, "dist", "qa", `screenshot-translation-${suffix}.png`) });
    overlay = await beginCapture("latex");
    await selectFixture(overlay);
    await panel.waitForFunction(() => document.querySelector("#formula-preview .katex") && document.getElementById("stop").hidden);
    assert.equal(await panel.locator("#result").textContent(), String.raw`\frac{x^{2}}{2}+\sqrt{y}=\sum_{i=1}^{n}i`);
    await panel.locator("#copy").click();
    await panel.waitForFunction(() => document.getElementById("copy").title === "已复制");
    await panel.waitForFunction(expected => window.liuli.clipboardText().then(text => text === expected),
      await panel.locator("#result").textContent(), { timeout: 5000 });
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), await panel.locator("#result").textContent());
    await panel.screenshot({ path: path.join(project, "dist", "qa", `latex-${suffix}.png`) });
    await settings.evaluate(() => window.liuli.savePreferences({ enhanceSilentOCR: false }));
    const beforeSilent = requests.length;
    overlay = await beginCapture("silent");
    await selectFixture(overlay);
    if (localOCRAvailable) {
      await panel.waitForFunction(() => window.liuli.clipboardText().then(text => /Hello\s*world/i.test(text)), undefined, { timeout: 5000 });
      assert.match(await application.evaluate(({ clipboard }) => clipboard.readText()), /Hello\s*world/i);
    }
    assert.equal(requests.length, beforeSilent, "local-only silent OCR must work without a model call");
    assert.equal(await panelVisible(), false);
    await settings.evaluate(() => window.liuli.savePreferences({ enhanceSilentOCR: true }));
    overlay = await beginCapture("silent");
    await selectFixture(overlay);
    await panel.waitForFunction(() => window.liuli.clipboardText().then(text => text === "截图识别结果：Hello world"), undefined, { timeout: 5000 });
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), "截图识别结果：Hello world");
    assert.equal(await panelVisible(), false);
    const entries = await settings.evaluate(() => window.liuli.history());
    assert.ok(entries.some(item => item.mode === "latex" && item.result.includes("frac")));
    assert.ok(entries.some(item => item.mode === "ocr-translate" && item.source === "Hello world" && item.result === "你好，世界。"));
    assert.ok(entries.every(item => !item.imageBase64));
    raceClipboard = true;
    overlay = await beginCapture("silent");
    await selectFixture(overlay);
    await panel.waitForFunction(() => window.liuli.clipboardText().then(text => text === "new user clipboard"), undefined, { timeout: 5000 });
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), "new user clipboard", "model refinement must not overwrite a later user copy");
    await settings.evaluate(id => window.liuli.restoreHistory(id), entries.find(item => item.mode === "latex").id);
    await panel.waitForFunction(() => document.querySelector("#formula-preview .katex"));
    await captureFixture.evaluate(w => w.destroy()); await captureFixture.dispose();
    await openPanel();
    await panel.locator("#pin").click();
    assert.equal(
      await panel.locator("#pin").getAttribute("aria-pressed"),
      "true",
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("settings.html"))
        .focus(),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(await panelVisible(), true);
    await openPanel();
    await panel.locator("#pin").click();
    await openSettings();
    await waitPanel(false);
    await settings.locator('[data-section="general"]').click();
    await settings.screenshot({
      path: path.join(project, "dist", "qa", `settings-${suffix}.png`),
    });
    await openPanel();
    await panel.locator("#source").press("Escape");
    await waitPanel(false);
    await openPanel();
    if (await panel.locator("#remove-image").isVisible()) await panel.locator("#remove-image").click();
    await openTools();
    await panel.locator('[data-mode="translate"]').click();
    await panel.locator("#source").fill("CANCEL_TEST");
    await panel.locator("#translate").click();
    await panel.waitForFunction(() =>
      document.getElementById("result").textContent.includes("开始生成"),
    );
    await panel.locator("#stop").click();
    await panel.waitForFunction(() => document.getElementById("stop").hidden);
    for (let i = 0; i < 50 && !cancelledRequest; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cancelledRequest, true);

    // Account settings are a real separate window, retaining credential isolation.
    await openSettings();
    await settings.locator('[data-section="accounts"]').click();
    await settings.locator("#provider").selectOption("openai");
    await settings.locator("#auth-type").selectOption("api_key");
    await settings.locator("#api-key").fill("liuli-local-test-key");
    await settings.locator("#login").click();
    await settings.waitForFunction(() =>
      document.getElementById("login-state").textContent.includes("登录成功"),
    );
    const authFile = path.join(agentDir, "auth.json");
    assert.equal(
      JSON.parse(await fs.readFile(authFile, "utf8")).openai.key,
      "liuli-local-test-key",
    );
    assert.equal(await settings.locator("#api-key").inputValue(), "");
    await settings.locator("#logout").click();
    await settings.waitForFunction(
      () =>
        document.getElementById("provider-state").textContent === "尚未配置",
    );
    assert.equal(
      JSON.parse(await fs.readFile(authFile, "utf8")).openai,
      undefined,
    );
    await settings.locator("#api-key").fill("unsaved-placeholder");
    await settings.keyboard.press("Escape");
    assert.equal(await settings.locator("#api-key").inputValue(), "");
    await panel.evaluate(() => window.liuli.showSettings("general"));
    assert.equal(application.windows().length, 2);
    const daemonPid = await application.evaluate(
      ({ app }) =>
        app
          .getAppMetrics()
          .find((metric) => metric.name === "Liuli translation daemon")?.pid,
    );
    assert.ok(daemonPid);
    const chromePid = await application.evaluate(({ app }) => process.mainModule.require(`${app.getAppPath()}/main.cjs`).windowChrome?.child?.pid);
    assert.ok(chromePid);
    assert.deepEqual(rendererErrors, []);
    assert.equal(await closeElectron(application), true, "Electron should exit gracefully");
    application = undefined;
    assert.throws(() => process.kill(daemonPid, 0), /ESRCH/);
    assert.throws(() => process.kill(chromePid, 0), /ESRCH/);
    // The explicit choice must survive a process restart, including the hidden card.
    application = await electron.launch({ ...(process.env.LIULI_E2E_EXECUTABLE
      ? { executablePath: process.env.LIULI_E2E_EXECUTABLE, args: [] } : { args: [desktop] }), env, cwd: desktop });
    await application.firstWindow();
    for (let i = 0; i < 200; i++) {
      settings = application.windows().find(p => p.url().endsWith("settings.html"));
      panel = application.windows().find(p => p.url().endsWith("panel.html"));
      if (settings && panel) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await settings.waitForFunction(() => document.getElementById("theme").value === "light");
    for (const page of [settings, panel]) await page.waitForFunction(() => document.documentElement.dataset.appearance === "light");
    assert.equal(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource), "light");
    assert.equal(await closeElectron(application), true, "Electron should exit gracefully");
    application = undefined;
  },
);
