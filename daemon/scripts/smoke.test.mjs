import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const daemonDir = fileURLToPath(new URL("../", import.meta.url));

async function bounded(promise, message, timeout = 20_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function launch(t, overrides = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "liuli-中文 smoke-"));
  // Use a fresh home and only OS process settings: smoke tests must not read
  // personal Pi credentials or send requests using inherited provider API keys.
  const env = Object.fromEntries([
    "PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
  ].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
    PI_OFFLINE: "1", LIULI_PORT: "0", LIULI_PROXY_PORTS: "0",
    LIULI_TOKEN: randomUUID(), ...overrides,
  });
  let output = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    process.on("message", (message) => {
      if (message === "shutdown") process.emit("SIGINT");
    });
    await import("./dist/index.mjs");
  `], { cwd: daemonDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const exited = new Promise((resolve) => {
    child.once("error", (error) => { readyReject(error); resolve({ code: -1 }); });
    child.once("exit", (code, signal) => {
      readyReject(new Error(`Daemon exited before startup (${code}, ${signal}): ${output}`));
      resolve({ code, signal });
    });
  });
  // An occupied port is expected to exit without becoming ready.
  void ready.catch(() => {});
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    output += chunk.toString();
    const match = output.match(/\[liuli\] (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) readyResolve(match[1]);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await bounded(exited, "Daemon did not stop");
    await rm(home, { recursive: true, force: true });
  });
  return { child, ready, exited, output: () => output, token: env.LIULI_TOKEN };
}

test("built daemon boots without credentials, serves authenticated API and shuts down", {
  timeout: 40_000,
}, async (t) => {
  const daemon = await launch(t);
  const url = await bounded(daemon.ready, "Daemon startup timed out");
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const request = (route, options = {}) => fetch(`${url}${route}`, {
    ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(5_000),
  });
  assert.equal((await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) })).status, 401);
  assert.equal((await request("/health", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, false);
  const providers = await (await request("/v1/providers")).json();
  assert.ok(providers.providers.length > 0);
  assert.equal(providers.providers.some((provider) => provider.configured), false);
  assert.deepEqual((await (await request("/v1/models")).json()).models, []);
  assert.equal((await request("/v1/task", { method: "POST", body: "bad json" })).status, 400);
  const task = await request("/v1/task", {
    method: "POST", body: JSON.stringify({ mode: "translate", text: "Hello 世界" }),
  });
  assert.match(await task.text(), /event: error\ndata: .*没有可用模型/);

  const conflict = await launch(t, { LIULI_PORT: new URL(url).port });
  const conflictExit = await bounded(conflict.exited, "Port conflict did not exit");
  assert.equal(conflictExit.code, 1);
  assert.match(conflict.output(), /已被占用/);
  assert.match(conflict.output(), process.platform === "win32" ? /Get-NetTCPConnection/ : /lsof/);
  assert.equal((await request("/health")).status, 200);

  // An IPC message emits the same event as Ctrl+C on every CI platform.
  daemon.child.send("shutdown");
  assert.equal((await bounded(daemon.exited, "Graceful shutdown timed out")).code, 0);
  await assert.rejects(fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) }));
});
