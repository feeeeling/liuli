# 琉璃 Liuli

<p align="center"><img src="docs/assets/icon.png" width="128" alt="琉璃"></p>

macOS / Windows 桌面翻译面板。macOS 使用 SwiftUI + AppKit 原生界面，交互接近 [Bob](https://github.com/ripperhe/Bob)；Windows 使用 Electron 桌面界面。支持文本翻译、截图 OCR / 图译、公式转 LaTeX、解释与追问。

底层是随 App 启停的 [Pi Agent](https://github.com/earendil-works/pi) 守护进程。凭证写在 `~/.pi/agent/auth.json`，和终端 `pi` 共用。

面板在 **macOS 26（Tahoe）+** 使用系统液态玻璃（`NSGlassEffectView`）；**macOS 15–25** 自动降级为 `NSVisualEffectView` 磨砂玻璃。最低系统 15.0。本机调试降级可设 `LIULI_FORCE_FROSTED=1`。

```
选中文字 / 截图 / 输入
        │
        ▼
  琉璃.app（macOS） / Liuli.exe（Windows）
        │  HTTP SSE  127.0.0.1（桌面版独立空闲端口）
        ▼
  liuli-daemon  ·  Pi Agent SDK
        │
        ▼
  ~/.pi/agent/auth.json
```

## Windows

Windows 11 x64 已在本机验证。Windows 10 和 ARM64 尚未实测。

### 从源码运行

安装 **Node.js 22.12+** 和 Git，在 PowerShell 中执行：

```powershell
git clone https://github.com/feeeeling/liuli.git
cd liuli
.\scripts\desktop-windows.ps1 -Action Install
.\scripts\desktop-windows.ps1 -Action Start
```

脚本兼容 Windows PowerShell 5.1 / PowerShell 7，支持中文和空格路径，不需要 make、Swift 或 Bash。若本机执行策略限制脚本，可仅对这次运行使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop-windows.ps1 -Action Start`。

启动后打开独立设置窗口，顶部分类为「通用 / 快捷键 / 模型 / 账号」。在「账号」登录供应商，再到「模型」选择型号；已有 Pi / OpenAI Codex 登录可直接使用，凭证与 Pi CLI 共用。支持图片的模型标有「视觉」。

日常通过快捷键打开鼠标附近的无边框悬浮卡片。卡片不显示应用名称、图标或设置表单，采用与 Mac 接近的中性配色、圆角和间距；Windows 11 支持原生 Acrylic 毛玻璃，可在「通用 → 外观 → 主题」选择跟随系统、浅色或深色，两个窗口立即同步，重启保留选择；同时适配高对比度与降低透明度设置。顶部拖动位置，边缘或右下角拖动调整宽度和可用高度；后续内容仍自动伸缩，无需切换模式或点击恢复按钮。Esc / × 收起，图钉保持显示。

| 操作 | Windows 入口 |
| --- | --- |
| 输入翻译 | Alt+A；输入后点击箭头或 Ctrl+Enter |
| 划词翻译 | 选中文字后按 Alt+D，无需手动复制 |
| 截图翻译 | Alt+S，框选后自动识别并翻译，原文与译文分开显示 |
| 截图 OCR | Alt+Shift+S，框选后识别文字 |
| 公式转 LaTeX | Alt+L，框选后显示公式预览与可复制源码 |
| 静默 OCR | Alt+C，框选后复制文字；本地 OCR 可选模型精修，不弹出卡片 |
| 取消框选 | Esc 或右键，不修改剪贴板、不调用模型 |
| 图片文件 / 图片剪贴板 | 卡片「更多」中选择图片或粘贴截图；Ctrl+Shift+V 粘贴图片 |
| 解释与追问 | 结果下方 › / 追问，可检索设置的本地 Wiki |
| 历史 | 设置 → 通用 → 历史，最近 40 条结果可恢复和清空，图片不保存 |
| 设置 / 退出 | 卡片「更多」或托盘菜单；设置窗口有退出入口 |

六组全局快捷键可在设置中录制和修改；冲突时提示并保留其他可用入口。截图翻译也有卡片底部的框选图标和托盘入口，LaTeX / OCR 等操作收在「更多」中。

截图选区在鼠标所在显示器框选，按实际屏幕像素裁剪，兼容缩放和负坐标显示器。Windows 本地 OCR 使用系统已有 OCR 语言包；没有可用语言包时，截图翻译和 OCR 仍可通过视觉模型完成。静默 OCR 在识别期间若检测到剪贴板发生变化，会保留新复制的内容。公式预览使用本地 KaTeX 资源，不依赖 CDN；无法排版的公式保留源码供复制。

划词优先读取 Windows 辅助功能选区，必要时自动复制并恢复原剪贴板；空选区不使用旧剪贴板，密码框不读取，终端不发送 Ctrl+C。卡片默认约 420 个逻辑像素宽，短句自动收紧，长内容受屏幕可用空间和用户调整的高度上限约束，并在卡片内滚动；重启保留用户偏好的宽度和高度上限。右下角手柄支持方向键微调，Shift+方向键每次调整 50。

若模型被当前订阅拒绝，请在设置中切换到可调用的型号；选择保存在本机。Windows 10、ARM64 和多屏实机组合仍需在相应设备上验证；macOS Liquid Glass 与 Windows Acrylic 使用各自系统材质。

### 检查与打包

```powershell
.\scripts\desktop-windows.ps1 -Action Check
.\scripts\desktop-windows.ps1 -Action Package
```

打包输出 `dist\Liuli-win32-x64\Liuli.exe`（在 x64 Windows 构建）。分发时需保留整个目录；打包程序已包含 Electron/Node 与后端依赖，使用者无需另装 Node。版本发布工作流也会构建 `Liuli-windows-x64.zip`。

只运行后端可以使用 `scripts\daemon-windows.ps1`，支持 `-Action Install/Check/Build/Start` 和 `-Port 17892`。桌面版自动使用独立空闲端口并管理后端生命周期，不会占用另一个实例的固定端口。代理优先级为 `LIULI_HTTP_PROXY` → 环境代理 → Windows 系统静态 HTTP(S) 代理 → 常见本地混合端口；PAC 不自动解析。可通过 `LIULI_USER_DATA_DIR` 指定桌面偏好目录。

测试范围和复现命令见 [Windows 测试记录](docs/windows-testing.md)。

## macOS 安装

```bash
curl -fsSL https://raw.githubusercontent.com/feeeeling/liuli/main/install.sh | bash
```

默认下载 [GitHub Releases](https://github.com/feeeeling/liuli/releases) 里的预编译 `Liuli.app`（几秒到一两分钟），装到 `~/Applications`。没有 Release 时才本地编译。

强制从源码编译：

```bash
LIULI_FROM_SOURCE=1 curl -fsSL https://raw.githubusercontent.com/feeeeling/liuli/main/install.sh | bash
```

发布新版本：打 tag 后 GitHub Actions 会自动打包并上传 Release。

```bash
git tag v0.2.0 && git push origin v0.2.0
```

从源码：

```bash
git clone https://github.com/feeeeling/liuli.git
cd liuli
make daemon-install && make app && make install
```

## macOS 使用

菜单栏会出现「琉璃」。第一次请授权（每个权限只做一次）：

1. **辅助功能** — 划词翻译
2. **屏幕录制** — 截图翻译 / OCR / 公式（不要开音频）

然后在 **设置 → 账号** 登录模型供应商（ChatGPT 订阅用 OpenAI Codex；API Key 用对应供应商），或终端执行 `pi login`。安装脚本若未检测到 `pi`，会接着安装 Pi CLI。

启动应用、打开模型设置或点击「刷新模型列表」时，会通过 Pi 的在线目录获取已配置供应商的最新模型，无需升级应用来添加新模型。网络失败时保留本地列表并显示提示；`PI_OFFLINE` 模式只使用本地目录。

| 快捷键 | 作用 |
| --- | --- |
| ⌥D | 划词翻译 |
| ⌥S | 截图翻译 |
| ⇧⌥S | 截图 OCR |
| ⌥L | 公式转 LaTeX |
| ⌥A | 输入翻译 |
| ⌥C | 静默 OCR（复制到剪贴板） |
| 译文下方 `>` | 简要解释并追问；可检索本地 wiki |
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
| `LIULI_FORCE_FROSTED` | `1` 时强制磨砂玻璃（在 Tahoe 上预览 15–25 降级） |

菜单栏 App 不继承终端 `HTTP_PROXY`；守护进程会探测 Clash 混合端口（7890 等）和系统代理。

## 目录

```
app/        SwiftUI 菜单栏 + 悬浮面板
desktop/    Windows Electron 桌面面板 + 打包与界面测试
daemon/     Pi Agent HTTP + SSE
scripts/    macOS 打包 / Windows PowerShell 入口 / vendor Node
install.sh  一键安装
```

## License

MIT
