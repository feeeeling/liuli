import assert from "node:assert/strict";
import test from "node:test";
import { windowsProxyUrl } from "./windows-proxy.ts";

test("Windows static proxies accept host:port and explicit HTTP(S) URLs", () => {
  for (const [setting, expected] of [
    ["127.0.0.1:8888", "http://127.0.0.1:8888"],
    [" http://proxy.example:8080 ", "http://proxy.example:8080"],
    ["https://proxy.example:8443", "https://proxy.example:8443"],
    ["[::1]:7890", "http://[::1]:7890"],
  ]) {
    assert.equal(windowsProxyUrl({ ProxyEnable: 1, ProxyServer: setting }), expected);
  }
});

test("Windows protocol maps choose HTTPS then HTTP and ignore SOCKS-only settings", () => {
  assert.equal(windowsProxyUrl({ ProxyEnable: 1,
    ProxyServer: "http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080",
  }), "http://127.0.0.1:8443");
  assert.equal(windowsProxyUrl({ ProxyEnable: 1,
    ProxyServer: "http=127.0.0.1:8080;socks=127.0.0.1:1080",
  }), "http://127.0.0.1:8080");
  assert.equal(windowsProxyUrl({ ProxyEnable: 1, ProxyServer: "socks=127.0.0.1:1080" }), undefined);
});

test("disabled, empty, invalid and non-HTTP Windows proxies are ignored", () => {
  for (const settings of [
    {}, { ProxyEnable: 0, ProxyServer: "127.0.0.1:7890" },
    { ProxyEnable: 1 }, { ProxyEnable: 1, ProxyServer: "" },
    { ProxyEnable: 1, ProxyServer: "proxy:99999" },
    { ProxyEnable: 1, ProxyServer: "socks5://127.0.0.1:1080" },
  ]) assert.equal(windowsProxyUrl(settings), undefined);
});
