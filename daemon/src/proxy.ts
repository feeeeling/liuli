import net from "node:net";
import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  setGlobalDispatcher,
} from "undici";

function alreadyConfigured(): boolean {
  return Boolean(
    process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy,
  );
}

function apply(url: string, reason: string): void {
  process.env.HTTP_PROXY = url;
  process.env.HTTPS_PROXY = url;
  process.env.http_proxy = url;
  process.env.https_proxy = url;
  process.env.NO_PROXY = process.env.NO_PROXY || "127.0.0.1,localhost,::1";
  process.env.NODE_USE_ENV_PROXY = "1";
  installDispatcher();
  console.log(`[liuli] proxy ${url} (${reason})`);
}

function installDispatcher(): void {
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: 300_000,
      headersTimeout: 300_000,
    }),
  );
  // OpenAI SDK uses global fetch. Node's builtin fetch has a separate undici
  // copy, so the dispatcher only applies if we install the same implementation.
  globalThis.fetch = undiciFetch as typeof fetch;
}

function canConnect(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** GUI apps do not inherit shell HTTP_PROXY. Detect Clash / system proxy before any model call. */
export async function applyProxy(): Promise<void> {
  process.env.NODE_USE_ENV_PROXY = process.env.NODE_USE_ENV_PROXY || "1";
  process.env.NO_PROXY = process.env.NO_PROXY || "127.0.0.1,localhost,::1";

  if (process.env.LIULI_HTTP_PROXY) {
    apply(process.env.LIULI_HTTP_PROXY, "LIULI_HTTP_PROXY");
    return;
  }
  if (alreadyConfigured()) {
    installDispatcher();
    console.log(
      `[liuli] proxy ${process.env.HTTPS_PROXY || process.env.HTTP_PROXY} (env)`,
    );
    return;
  }

  const ports = (process.env.LIULI_PROXY_PORTS || "7890,7897,1087,6152")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => n > 0);
  for (const port of ports) {
    if (await canConnect("127.0.0.1", port)) {
      apply(`http://127.0.0.1:${port}`, "local");
      return;
    }
  }
  console.warn(
    "[liuli] 未检测到 HTTP 代理。若终端里 pi 要走代理，请设置 LIULI_HTTP_PROXY 或打开 Clash 混合端口。",
  );
}
