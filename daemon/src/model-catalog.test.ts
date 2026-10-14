import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { LiveModelCatalog } from "./model-catalog.ts";

test("live catalog discovers new models, bypasses freshness cache and coalesces requests", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "liuli-models-"));
  const authPath = path.join(dir, "auth.json");
  await fs.writeFile(authPath, JSON.stringify({ openai: { type: "api_key", key: "test-key" } }));
  let requests = 0;
  let models: ReturnType<ModelRuntime["getModels"]> = [];
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/models/providers/openai");
    requests++;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Last-Modified": "Fri, 01 Jan 2100 00:00:00 GMT",
      ETag: `"catalog-${requests}"`,
    });
    res.end(JSON.stringify(models));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as import("node:net").AddressInfo;
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
      catalogBaseUrl: `http://127.0.0.1:${address.port}`,
    });
    const baseline = runtime.getModels("openai")[0];
    assert.ok(baseline);
    // Fictional IDs exercise discovery independently of the SDK's bundled catalog.
    models = [{ ...baseline, id: "liuli-new-vision-model", name: "New vision model", input: ["text", "image"] }];
    const catalog = new LiveModelCatalog(runtime);
    assert.deepEqual(await Promise.all([catalog.refresh(), catalog.refresh(), catalog.refresh()]), [undefined, undefined, undefined]);
    assert.equal(requests, 1);
    const discovered = (await runtime.getAvailable()).find((m) => m.id === "liuli-new-vision-model");
    assert.equal(discovered?.name, "New vision model");
    assert.ok(discovered?.input.includes("image"));

    models = [...models, { ...baseline, id: "liuli-second-model", name: "Second model" }];
    assert.equal(await catalog.refresh(), undefined);
    assert.equal(requests, 2);
    assert.ok((await runtime.getAvailable()).some((m) => m.id === "liuli-second-model"));

    // Disconnect the catalog service: discovery must retain the last successful list.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match((await catalog.refresh()) ?? "", /刷新失败/);
    assert.ok((await runtime.getAvailable()).some((m) => m.id === "liuli-second-model"));
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("catalog refresh is bounded and can retry after a timeout", async () => {
  let calls = 0;
  const runtime = {
    getProviders: () => [{ id: "openai-codex" }],
    hasConfiguredAuth: () => true,
    refresh: async (options: Parameters<ModelRuntime["refresh"]>[0]) => {
      calls++;
      assert.equal(options?.allowNetwork, true);
      assert.equal(options?.force, true);
      assert.deepEqual(options?.providers, ["openai-codex"]);
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          options?.signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        return { aborted: true, errors: new Map<string, Error>() };
      }
      return { aborted: false, errors: new Map<string, Error>() };
    },
  };
  const catalog = new LiveModelCatalog(runtime, 20);
  assert.match((await catalog.refresh()) ?? "", /超时/);
  assert.equal(await catalog.refresh(), undefined);
  assert.equal(calls, 2);
});

test("unconfigured providers do not trigger network discovery", async () => {
  const catalog = new LiveModelCatalog({
    getProviders: () => [{ id: "openai-codex" }],
    hasConfiguredAuth: () => false,
    refresh: async () => { throw new Error("must not refresh"); },
  });
  assert.equal(await catalog.refresh(), undefined);
});
