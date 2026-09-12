import { applyProxy } from "./proxy.ts";

await applyProxy();

const { LiuliAgent } = await import("./agent.ts");
const { startServer } = await import("./server.ts");

const agent = new LiuliAgent();
const health = await agent.start();
if (!health.ok) {
  console.error(`[liuli] ${health.error}`);
}

const server = startServer(agent);

const shutdown = async () => {
  agent.cancelLogin();
  await agent.abort();
  agent.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
