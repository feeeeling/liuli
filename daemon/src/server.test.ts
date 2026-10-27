import assert from "node:assert/strict";
import { once } from "node:events";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { LiuliAgent, RunHandlers } from "./agent.ts";
import { startServer } from "./server.ts";
import type { TaskRequest } from "./types.ts";

async function withServer(
  overrides: Partial<LiuliAgent>,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const agent = {
    health: () => ({ ok: true, model: "test", provider: "test", vision: true }),
    abort: async () => {},
    ...overrides,
  } as LiuliAgent;
  const previousPort = process.env.LIULI_PORT;
  process.env.LIULI_PORT = "0";
  let server: http.Server;
  try {
    server = startServer(agent);
  } finally {
    if (previousPort === undefined) delete process.env.LIULI_PORT;
    else process.env.LIULI_PORT = previousPort;
  }
  await once(server, "listening");
  try {
    const { port, address } = server.address() as AddressInfo;
    assert.equal(address, "127.0.0.1");
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const taskBody = JSON.stringify({ mode: "translate", text: "Hello 世界" });

test("HTTP health and task validation work on loopback", async () => {
  await withServer({}, async (url) => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    for (const body of ["not json", JSON.stringify({ mode: "translate" })]) {
      const response = await fetch(`${url}/v1/task`, { method: "POST", body });
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error);
    }
  });
});

test("task streams Unicode deltas and completes without aborting", async () => {
  let aborted = false;
  await withServer({
    abort: async () => { aborted = true; },
    run: async (task: TaskRequest, handlers: RunHandlers) => {
      assert.equal(task.text, "Hello 世界");
      handlers.onDelta("你好");
      await delay(30);
      assert.equal(aborted, false);
      handlers.onDelta("，世界");
      return "你好，世界";
    },
  }, async (url) => {
    const response = await fetch(`${url}/v1/task`, { method: "POST", body: taskBody });
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = await response.text();
    assert.match(body, /event: delta\ndata: \{"text":"你好"\}/);
    assert.match(body, /event: done\ndata: \{"text":"你好，世界","mode":"translate"\}/);
    assert.equal(aborted, false);
  });
});

test("disconnecting a streaming client aborts its model request", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let aborted = false;
  await withServer({
    abort: async () => { aborted = true; release(); },
    run: async (_task: TaskRequest, handlers: RunHandlers) => {
      handlers.onDelta("开始");
      await pending;
      return "结束";
    },
  }, async (url) => {
    const controller = new AbortController();
    try {
      const response = await fetch(`${url}/v1/task`, {
        method: "POST", body: taskBody, signal: controller.signal,
      });
      assert.equal((await response.body!.getReader().read()).done, false);
      controller.abort();
      for (let i = 0; i < 50 && !aborted; i++) await delay(20);
      assert.equal(aborted, true, "a closed response must cancel generation");
    } finally {
      controller.abort();
      release();
    }
  });
});
