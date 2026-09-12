# 琉璃 Liuli

<p align="center">
  <img src="docs/assets/icon.png" width="128" height="128" alt="琉璃图标" />
</p>

<p align="center">
  macOS 全局翻译面板：快捷键唤起液态玻璃悬浮窗，划词翻译、截图 OCR / 图译、公式转 LaTeX。
</p>

<p align="center">
  <a href="https://github.com/feeeeling/liuli/releases"><img src="https://img.shields.io/github/v/release/feeeeling/liuli?include_prereleases" alt="release" /></a>
  <img src="https://img.shields.io/badge/macOS-15%2B-black" alt="macOS 15+" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" />
</p>

交互接近 [Bob](https://github.com/ripperhe/Bob)。底层是随 App 启停的 [Pi Agent](https://github.com/earendil-works/pi) 守护进程；凭证写在 `~/.pi/agent/auth.json`，和终端 `pi` 共用。

## 功能

- **划词翻译** — 选中文字，快捷键出译文
- **截图翻译 / OCR / 图译** — 框选屏幕区域识别或翻译
- **公式 → LaTeX** — 截图公式，输出可复制的 LaTeX，并做预览
- **输入翻译** — 在面板里直接输入
- **静默 OCR** — 识别结果直接进剪贴板

## 演示

<!-- 之后可换成真实面板截图 / GIF -->
面板为液态玻璃悬浮窗：原文、译文 / LaTeX、模型与目标语言可在页脚切换。

## 架构

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

本地 daemon 负责把面板请求交给 Pi；登录态不进 App 沙盒，终端与面板共用同一套供应商账号。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/feeeeling/liuli/main/install.sh | bash
```

默认下载 [GitHub Releases](https://github.com/feeeeling/liuli/releases) 里的预编译 `Liuli.app`，装到 `~/Applications`。没有 Release 时才本地编译。

强制从源码编译：

```bash
LIULI_FROM_SOURCE=1 curl -fsSL https://raw.githubusercontent.com/feeeeling/liuli/main/install.sh | bash
```

发布新版本：打 tag 后 GitHub Actions 会打包并上传 Release。

```bash
git tag v0.1.1 && git push origin v0.1.1
```

从源码：

```bash
git clone https://github.com/feeeeling/liuli.git
cd liuli
make daemon-install && make app && make install
```

## 首次使用

菜单栏会出现「琉璃」。第一次请授权（每个权限只做一次）：

1. **辅助功能** — 划词翻译
2. **屏幕录制** — 截图翻译 / OCR / 公式（不要开音频）

然后在 **设置 → 账号** 登录模型供应商（ChatGPT 订阅用 OpenAI Codex；API Key 用对应供应商），或终端执行 `pi login`。安装脚本若未检测到 `pi`，会接着安装 Pi CLI。

## 快捷键

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

## 配置

| 变量 | 含义 |
| --- | --- |
| `LIULI_PORT` | 守护进程端口，默认 `17891` |
| `LIULI_HTTP_PROXY` | 覆盖自动探测的代理 |
| `LIULI_MODEL` | 指定模型，如 `xai/grok-4.6` |

菜单栏 App 不继承终端 `HTTP_PROXY`；守护进程会探测 Clash 混合端口（7890 等）和系统代理。

## 开发

```bash
make daemon-install
make dev          # 打 debug .app 并打开，不要 swift run
```

请固定用 `dist/Liuli.app` 或 `~/Applications/Liuli.app`，否则 TCC 权限会丢。

### 应用图标

母版：`app/Resources/AppIcon-1024.png`（双弧 + 磨砂玻璃底板）。`scripts/bundle.sh` 在 macOS 上若有 `iconutil`，会生成 `AppIcon.icns` 打进包内。

```
app/        SwiftUI 菜单栏 + 悬浮面板
daemon/     Pi Agent HTTP + SSE
scripts/    打包 / 开发启动 / vendor Node
docs/assets/  README 图标等
install.sh  一键安装
```

## License

MIT
