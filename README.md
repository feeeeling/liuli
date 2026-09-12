# 琉璃 Liuli

macOS 全局翻译面板，交互接近 [Bob](https://github.com/ripperhe/Bob)：快捷键唤起液态玻璃悬浮窗，选中文字即时翻译，截图 OCR / 图译，公式转 LaTeX。

底层是随 App 启停的 [Pi Agent](https://github.com/earendil-works/pi) 守护进程。凭证写在 `~/.pi/agent/auth.json`，和终端 `pi` 共用。

```
选中文字 / 截图 / 输入
        │
        ▼
  琉璃.app  ·  SwiftUI + AppKit Liquid Glass
        │  HTTP SSE  127.0.0.1:17891
        ▼
  liuli-daemon  ·  Pi Agent SDK
        │
        ▼
  ~/.pi/agent/auth.json
```

## 安装

macOS 15+，需要 [Xcode Command Line Tools](https://developer.apple.com/download/all/?q=command%20line%20tools) 和 Node.js 22+。

```bash
curl -fsSL https://raw.githubusercontent.com/feeeeling/liuli/main/install.sh | bash
```

会检查并安装 [Pi](https://github.com/earendil-works/pi) CLI（若本机没有 `pi`），克隆到 `~/.liuli/src`，编译后装到 `~/Applications/Liuli.app` 并打开。

从源码安装：

```bash
git clone https://github.com/feeeeling/liuli.git
cd liuli
./install.sh
```

或 `make daemon-install && make app && make install`。

## 使用

菜单栏会出现「琉璃」。第一次请授权（每个权限只做一次）：

1. **辅助功能** — 划词翻译
2. **屏幕录制** — 截图翻译 / OCR / 公式（不要开音频）

然后在 **设置 → 账号** 登录模型供应商（ChatGPT 订阅用 OpenAI Codex；API Key 用对应供应商），或终端执行 `pi login`。安装脚本若未检测到 `pi`，会用 `npm i -g @earendil-works/pi-coding-agent`（失败则回退 `https://pi.dev/install.sh`）。

| 快捷键 | 作用 |
| --- | --- |
| ⌥D | 划词翻译 |
| ⌥S | 截图翻译 |
| ⇧⌥S | 截图 OCR |
| ⌥L | 公式转 LaTeX |
| ⌥A | 输入翻译 |
| ⌥C | 静默 OCR（复制到剪贴板） |
| Esc | 关闭面板 |

快捷键可在设置里改。与 Bob 同时开着会冲突。

## 开发

```bash
make daemon-install
make dev          # 打 debug .app 并打开，不要 swift run
```

请固定用 `dist/Liuli.app` 或 `~/Applications/Liuli.app`，否则 TCC 权限会丢。

| 变量 | 含义 |
| --- | --- |
| `LIULI_PORT` | 守护进程端口，默认 `17891` |
| `LIULI_HTTP_PROXY` | 覆盖自动探测的代理 |
| `LIULI_MODEL` | 指定模型，如 `xai/grok-4.6` |

菜单栏 App 不继承终端 `HTTP_PROXY`；守护进程会探测 Clash 混合端口（7890 等）和系统代理。

## 目录

```
app/        SwiftUI 菜单栏 + 悬浮面板
daemon/     Pi Agent HTTP + SSE
scripts/    打包 / 开发启动 / vendor Node
install.sh  一键安装
```

## License

MIT
