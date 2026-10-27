const { parentPort, workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { ClipboardStore } = require("./clipboard-store.cjs");

let store, child, available = false, enabled = Boolean(workerData.enabled), suspended = 0, closing = false, error = "";
let commandId = 0;
const commands = new Map();
const status = () => ({ enabled, recording: enabled && !suspended && available, available,
  count: store?.entries.length || 0, bytes: store?.bytes || 0, limit: store?.limit || workerData.limit, error });
const changed = () => parentPort.postMessage({ type: "changed", status: status() });
function native(op, value) {
  if (!child || !available) return Promise.reject(new Error("剪贴板监听尚未就绪。"));
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { commands.delete(id); reject(new Error("剪贴板监听响应超时。")); }, 1500);
    commands.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, op, value }) + "\n");
  });
}
function startMonitor() {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(startTimer); resolve(); } };
    const process = spawn(workerData.helper, [enabled && !suspended ? "1" : "0"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    child = process;
    const startTimer = setTimeout(() => { process.kill(); finish(); }, 8000);
    const fail = () => {
      if (child !== process) return;
      child = undefined; available = false;
      if (!closing) error = "剪贴板监听暂不可用，可关闭后重新开启记录。";
      for (const { reject, timer } of commands.values()) { clearTimeout(timer); reject(new Error("剪贴板监听已停止。")); }
      commands.clear(); finish(); changed();
    };
    process.on("error", fail);
    process.on("exit", fail);
    process.stdin.on("error", () => {});
    createInterface({ input: process.stdout }).on("line", line => {
      if (line.length > 24 * 1024 * 1024) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.kind === "ready") { available = true; error = ""; finish(); changed(); }
      if (message.kind === "ack") {
        const pending = commands.get(message.id);
        if (pending) { clearTimeout(pending.timer); commands.delete(message.id); pending.resolve(message.value); }
      }
      if (message.kind === "snapshot" && enabled && !suspended && !closing) {
        void store.add(message.data).then(value => { if (value) changed(); }).catch(() => {
          error = "部分剪贴板记录未能保存。"; changed();
        });
      }
    });
  });
}
const initialized = (async () => {
  store = await new ClipboardStore(workerData.directory, Buffer.from(workerData.key), { limit: workerData.limit }).init();
  await startMonitor();
  parentPort.postMessage({ type: "ready", status: status() });
})().catch(() => {
  error = "本机剪贴板历史无法读取。";
  parentPort.postMessage({ type: "ready", status: status() });
});
parentPort.on("message", async ({ id, op, value }) => {
  try {
    await initialized;
    if (!store && op !== "shutdown") throw new Error("本机剪贴板历史无法读取。");
    let result;
    if (op === "query") result = { ...store.query(value), status: status() };
    else if (op === "read") { result = await store.read(value); changed(); }
    else if (op === "remove") { await store.remove(value); changed(); }
    else if (op === "clear") { await store.clear(); changed(); }
    else if (op === "configure") {
      enabled = Boolean(value.enabled);
      await store.configure(value.limit);
      if (enabled && !child) await startMonitor();
      if (available) await native("enabled", enabled && !suspended);
      changed(); result = status();
    } else if (op === "suspend") {
      suspended = Math.max(0, suspended + (value ? 1 : -1));
      if (available) await native("enabled", enabled && !suspended);
      result = status();
    } else if (op === "foreground") result = await native("foreground");
    else if (op === "shutdown") {
      closing = true;
      if (child) {
        const process = child;
        const stopped = new Promise(resolve => process.once("exit", resolve));
        process.stdin.end();
        const timer = setTimeout(() => process.kill(), 1500);
        await stopped; clearTimeout(timer);
      }
      await store?.flush();
    } else throw new Error("无效剪贴板操作。");
    parentPort.postMessage({ type: "reply", id, value: result });
    if (op === "shutdown") parentPort.close();
  } catch (error) {
    parentPort.postMessage({ type: "reply", id, error: error.message || "剪贴板操作失败。" });
  }
});
