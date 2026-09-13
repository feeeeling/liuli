import http from "node:http";
import { LiuliAgent } from "./agent.ts";
import { isAuthKind, parseTask } from "./types.ts";

const DEFAULT_PORT = 17891;
const HOST = "127.0.0.1";
const MAX_BODY = 20 * 1024 * 1024;

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sseWrite(
  res: http.ServerResponse,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  const flushed = (res as http.ServerResponse & { flush?: () => void }).flush;
  flushed?.call(res);
}

function authorized(req: http.IncomingMessage): boolean {
  const expected = process.env.LIULI_TOKEN;
  if (!expected) return true;
  return req.headers.authorization === `Bearer ${expected}`;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) {
      throw new Error("请求过大");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("无效 JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("无效 JSON");
  return parsed as Record<string, unknown>;
}

export function startServer(agent: LiuliAgent): http.Server {
  const port = Number(process.env.LIULI_PORT || DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (!authorized(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    try {
      if (req.method === "GET" && (url === "/health" || url === "/v1/health")) {
        sendJson(res, 200, agent.health());
        return;
      }
      if (req.method === "GET" && url === "/v1/providers") {
        sendJson(res, 200, { providers: agent.listProviders() });
        return;
      }
      if (req.method === "GET" && url === "/v1/models") {
        sendJson(res, 200, await agent.listModels());
        return;
      }
      if (req.method === "POST" && url === "/v1/model") {
        const body = parseJsonObject(await readBody(req));
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) {
          sendJson(res, 400, { error: "需要 id" });
          return;
        }
        sendJson(res, 200, await agent.setModel(id));
        return;
      }
      if (req.method === "POST" && url === "/v1/auth/logout") {
        const body = parseJsonObject(await readBody(req));
        const providerId =
          typeof body.providerId === "string" ? body.providerId : "";
        if (!providerId) {
          sendJson(res, 400, { error: "需要 providerId" });
          return;
        }
        await agent.logout(providerId);
        sendJson(res, 200, { ok: true, providers: agent.listProviders() });
        return;
      }
      if (req.method === "POST" && url === "/v1/auth/answer") {
        const body = parseJsonObject(await readBody(req));
        const id = typeof body.id === "string" ? body.id : "";
        const value = typeof body.value === "string" ? body.value : "";
        if (!id) {
          sendJson(res, 400, { error: "需要 id" });
          return;
        }
        agent.answerPrompt(id, value);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url === "/v1/auth/cancel") {
        agent.cancelLogin();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url === "/v1/abort") {
        await agent.abort();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url === "/v1/auth/login") {
        const body = parseJsonObject(await readBody(req));
        const providerId =
          typeof body.providerId === "string" ? body.providerId : "";
        const type = body.type;
        const apiKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
        if (!providerId || !isAuthKind(type)) {
          sendJson(res, 400, { error: "需要 providerId 和 type" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.socket?.setNoDelay(true);
        const close = () => agent.cancelLogin();
        // Request "close" fires after the POST body is read — that would abort
        // OAuth before the browser even opens. Cancel only if the client drops
        // the response stream.
        res.on("close", close);
        try {
          await agent.login(
            providerId,
            type,
            {
              onEvent: (event) => sseWrite(res, event.type, event),
              onPrompt: (prompt) => sseWrite(res, "prompt", prompt),
            },
            apiKey,
          );
          sseWrite(res, "done", { providerId });
        } catch (error) {
          sseWrite(res, "error", {
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          res.off("close", close);
          res.end();
        }
        return;
      }
      if (req.method === "POST" && url === "/v1/task") {
        let task;
        try {
          task = parseTask(await readBody(req));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        const continuing =
          task.action === "explain" || task.action === "followup";
        if (
          !continuing &&
          !task.text?.trim() &&
          !task.imageBase64
        ) {
          sendJson(res, 400, { error: "需要 text 或 imageBase64" });
          return;
        }
        if (task.action === "followup" && !task.text?.trim()) {
          sendJson(res, 400, { error: "需要追问内容" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const close = () => {
          void agent.abort();
        };
        req.on("close", close);

        try {
          const text = await agent.run(task, {
            onDelta: (delta) => sseWrite(res, "delta", { text: delta }),
          });
          sseWrite(res, "done", { text, mode: task.mode });
        } catch (error) {
          sseWrite(res, "error", {
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          req.off("close", close);
          res.end();
        }
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.end();
      }
    }
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[liuli] ${HOST}:${port} 已被占用。先停掉旧进程：lsof -iTCP:${port} -sTCP:LISTEN`,
      );
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    const health = agent.health();
    console.log(`[liuli] http://${HOST}:${port}`);
    if (health.ok) {
      console.log(
        `[liuli] model ${health.provider}/${health.model} vision=${health.vision}`,
      );
    } else {
      console.warn(`[liuli] ${health.error}`);
    }
  });

  return server;
}
