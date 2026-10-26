# 琉璃 Windows 预览版

Windows 10 22H2 / Windows 11，x64。原生 C# / WinUI 3 客户端与 macOS 共用 `daemon/`，使用 HTTP + SSE。

本阶段包含：输入翻译和取消、供应商 API Key / OAuth 登录、交互式登录提问、模型列表与切换、服务状态、日志、服务重启、单实例、MSIX 工程与 CI。划词、截图、OCR、公式预览、追问、上下文、wiki 界面、历史和托盘将在后续阶段实现。

## Windows 开发环境

- Visual Studio 2022（17.8 或更新），安装 .NET 桌面开发、Windows SDK 和 WinUI / Windows App SDK C# 工具。
- .NET 8 SDK、x64 Node >= 22.19.0、npm、x64 PowerShell 7。
- 从 Visual Studio Developer PowerShell 打开仓库根目录，确保 `msbuild` 在 PATH。

```powershell
./windows/scripts/prepare-daemon.ps1
msbuild windows/Liuli.Windows/Liuli.Windows.csproj /restore /p:Configuration=Debug /p:Platform=x64
```

然后在 Visual Studio 中打开 `windows/Liuli.Windows/Liuli.Windows.csproj`，选择 x64、启用开发者模式并部署运行。运行目录由构建脚本准备，包含私有 `runtime/node.exe`、daemon bundle 和生产依赖；不要直接复制 macOS 的 `node_modules`。

生成未签名 MSIX：

```powershell
./windows/scripts/build.ps1
```

产物在 `dist/windows-packages/`。CI 的未签名 MSIX 用于检查打包和留存预览产物，不能直接双击安装。开发部署使用 VS；分发安装前须配置与 manifest Publisher 一致且受目标系统信任的签名证书。不要提交证书或私钥。当前阶段不自动发布 Release，不导入信任证书，不变更系统安全设置。

## 测试

```powershell
cd daemon
npm ci
npm run typecheck
npm test
npm run build
cd ..
dotnet run --project windows/Liuli.Core.Tests -c Release -- (Get-Command node.exe).Source "$pwd/daemon/dist/index.mjs" "$pwd/daemon/src/windows-fixture.ts"
```

`Liuli.Core.Tests` 是无额外测试框架依赖的控制台契约测试，失败会返回非零退出码。它验证 SSE（多行、中文、CRLF、EOF、错误和中断）、HTTP 认证与字段、登录事件和回答、取消、子进程清理，并启动实际生产 bundle，验证无账号时仍可连接；Windows CI 还会强制终止一个测试宿主，验证 Job Object 清理其 daemon。测试覆盖真实 TCP 与子进程，不调用付费模型。测试使用隔离 HOME / USERPROFILE / PI_CODING_AGENT_DIR，不读取开发者的模型凭证。

核心库和契约测试可在安装 .NET 8 与 Node 的 macOS/Linux 上运行；WinUI、Windows Job Object 和 MSIX 需要 Windows。GitHub Actions 在 Windows Server 2022 x64 上执行上述测试并构建 MSIX，构建后还使用 MakeAppx 解包 MSIX，检查运行目录布局，并从实际包内再次运行 daemon 契约测试。它不代替 Windows 10/11 桌面交互验证。

## 生命周期和配置

- 客户端每次启动使用加密随机令牌，通过子进程环境传递。HTTP 只绑定 `127.0.0.1`，绕过系统 HTTP 代理。
- Windows 使用 `LIULI_PORT=0`，daemon 在 stdout 输出 `[liuli:ready] {"port":...,"protocol":1}`，客户端据此建立连接。macOS 默认端口仍为 17891。
- 45 秒启动超时；服务未配置模型时仍能进入账号界面。普通 API 请求 30 秒超时；翻译 5 分钟、登录 10 分钟，可主动停止。
- Windows Job Object 在主进程退出或崩溃时结束服务进程。只处理自己启动的子进程，端口冲突不终止未知进程。
- 日志：`%LOCALAPPDATA%/Liuli/Logs/daemon.log`（打包应用可能由系统重定向），每次启动超过 2 MiB 时轮换。
- 凭证交由 Pi SDK 管理，客户端不另外持久化 API Key。与终端 Pi 共用其配置目录；可用 `PI_CODING_AGENT_DIR` 指定隔离目录。
- 可通过启动进程继承的 `LIULI_HTTP_PROXY` / `HTTP_PROXY` / `HTTPS_PROXY` 配置代理；当前 daemon 也保留本机常见代理端口探测。Windows 系统代理读取后续补齐。

## 结构

```text
windows/
  Liuli.Core/           协议、SSE、HTTP 客户端、进程与 Job Object
  Liuli.Core.Tests/     无凭证的真实客户端与子进程契约测试
  Liuli.Windows/        WinUI 3 原生界面、manifest、MSIX 资源
  scripts/              Windows daemon 准备与构建入口
```

正式发布之前仍需：Windows 10/11 真机或虚拟机验证、实际供应商登录与翻译验证、签名安装测试。Apple Silicon 上 UTM 的 Windows ARM 可验证 x64 兼容运行，不能算作原生 x64 或 Windows 10 的验证。
