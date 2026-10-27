import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Windows Internet Settings supports both a single proxy and protocol maps. */
export function windowsProxyUrl(settings: {
  ProxyEnable?: unknown;
  ProxyServer?: unknown;
}): string | undefined {
  if (settings.ProxyEnable !== 1 || typeof settings.ProxyServer !== "string") return;
  const raw = settings.ProxyServer.trim();
  if (!raw) return;
  let endpoint = raw;
  if (raw.includes("=")) {
    const protocols = new Map(raw.split(";").map((entry) => {
      const index = entry.indexOf("=");
      return [entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim()];
    }));
    endpoint = protocols.get("https") || protocols.get("http") || "";
  }
  if (!endpoint) return;
  try {
    const url = new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return;
    return url.origin;
  } catch {
    return;
  }
}

export async function detectWindowsProxy(): Promise<string | undefined> {
  if (process.platform !== "win32") return;
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction Stop | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress",
    ], { windowsHide: true, timeout: 3_000, encoding: "utf8" });
    return windowsProxyUrl(JSON.parse(stdout));
  } catch {
    // Registry access may be restricted. Local-port detection is still usable.
    return;
  }
}
