import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { startServer, type DaemonAgent } from "./server.ts";

// Env belongs to this test worker process; no model or user credential access.
process.env.LIULI_PORT = "0";
process.env.LIULI_TOKEN = "contract-test-token";

function fakeAgent(overrides: Partial<DaemonAgent> = {}): DaemonAgent {
  return {
    health: () => ({ ok: false, error: "no model" }),
    listProviders: () => [], listModels: async () => ({ models: [] }),
    setModel: async () => ({ ok: true }), logout: async () => {},
    answerPrompt: () => {}, cancelLogin: () => {}, login: async () => {},
    abort: async () => {}, run: async () => "",
    ...overrides,
  };
}

async function serve(agent: DaemonAgent) {
  const server = startServer(agent);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}
const headers = { Authorization: "Bearer contract-test-token", "Content-Type": "application/json" };

test("loopback ephemeral server authenticates health even without a model", async () => {
  const service = await serve(fakeAgent());
  try {
    assert.equal((await fetch(`${service.base}/health`)).status, 401);
    const response = await fetch(`${service.base}/v1/health`, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false, error: "no model" });
  } finally { service.close(); }
});

test("reading the POST body does not abort a streaming translation", async () => {
  let aborts = 0;
  const service = await serve(fakeAgent({
    abort: async () => { aborts++; },
    run: async (_task, handler) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(aborts, 0);
      handler.onDelta("你好");
      return "你好";
    },
  }));
  try {
    const response = await fetch(`${service.base}/v1/task`, {
      method: "POST", headers, body: JSON.stringify({ mode: "translate", text: "hello" }),
    });
    const text = await response.text();
    assert.match(text, /event: delta\ndata: {"text":"你好"}/);
    assert.match(text, /event: done/);
    assert.equal(aborts, 0);
  } finally { service.close(); }
});

test("disconnecting the response cancels a running translation", async () => {
  let aborted!: () => void;
  const cancellation = new Promise<void>(resolve => { aborted = resolve; });
  const service = await serve(fakeAgent({
    abort: async () => { aborted(); },
    run: async () => { await cancellation; return "cancelled"; },
  }));
  const controller = new AbortController();
  try {
    const response = await fetch(`${service.base}/v1/task`, {
      method: "POST", headers, body: JSON.stringify({ mode: "translate", text: "wait" }), signal: controller.signal,
    });
    assert.equal(response.status, 200);
    controller.abort();
    await Promise.race([cancellation, new Promise((_, reject) => setTimeout(() => reject(new Error("not cancelled")), 1000))]);
  } finally { service.close(); }
});
