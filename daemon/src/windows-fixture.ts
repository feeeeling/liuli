// Deterministic subprocess fixture used by the native client contract tests.
// It exercises the real HTTP router without model credentials or network access.
import { startServer, type DaemonAgent } from "./server.ts";

let aborts = 0;
const agent: DaemonAgent = {
  health: () => ({ ok: true, provider: "fixture", model: String(process.pid), vision: false }),
  listProviders: () => [{ id: "fixture", name: "Fixture", configured: false, authTypes: ["api_key", "oauth"] }],
  listModels: async () => ({ models: [{ id: "model", name: "Model", provider: "fixture", vision: false }] }),
  setModel: async () => ({ ok: true }),
  logout: async () => {},
  answerPrompt: () => {},
  cancelLogin: () => {},
  login: async (_provider, _type, handlers) => {
    handlers.onEvent({ type: "auth", instructions: "fixture" });
    await handlers.onPrompt({ id: "prompt-1", type: "text", message: "Enter code" });
  },
  abort: async () => { aborts++; },
  run: async (task, handlers) => {
    if (task.text === "error") throw new Error("fixture failure");
    if (task.text === "wait") {
      while (aborts === 0) await new Promise(resolve => setTimeout(resolve, 10));
      return "aborted";
    }
    // Request-body 'close' must not abort this delay.
    await new Promise(resolve => setTimeout(resolve, 50));
    handlers.onDelta("你好");
    handlers.onDelta("，世界");
    return `你好，世界 (${aborts})`;
  },
};
startServer(agent);
