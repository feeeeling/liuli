using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Liuli.Core;

public sealed class DaemonHost : IAsyncDisposable
{
    private Process? process;
    private WindowsJob? job;
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    public DaemonClient? Client { get; private set; }
    public string LogPath { get; }

    public DaemonHost(string? logDirectory = null)
    {
        logDirectory ??= Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Liuli", "Logs");
        Directory.CreateDirectory(logDirectory);
        LogPath = Path.Combine(logDirectory, "daemon.log");
    }

    public async Task StartAsync(string nodePath, string daemonEntry,
        IReadOnlyDictionary<string, string>? environment = null, CancellationToken ct = default)
    {
        await lifecycle.WaitAsync(ct);
        try
        {
            if (process is { HasExited: false } && Client is not null) return;
            Stop();
            if (!File.Exists(nodePath) || !File.Exists(daemonEntry))
                throw new FileNotFoundException("未找到随应用分发的 Node 或 daemon，请重新构建 Windows 运行目录。");
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var ready = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            var info = new ProcessStartInfo(nodePath)
            {
                WorkingDirectory = Path.GetDirectoryName(daemonEntry)!,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            info.ArgumentList.Add(daemonEntry);
            if (environment is not null)
                foreach (var (key, value) in environment) info.Environment[key] = value;
            info.Environment["LIULI_PORT"] = "0";
            info.Environment["LIULI_TOKEN"] = token;
            info.Environment["NO_PROXY"] = "127.0.0.1,localhost,::1";
            var logGate = new object();
            void Log(string line)
            {
                // Never let a logging failure crash an async Process event handler.
                try { lock (logGate) File.AppendAllText(LogPath, line + Environment.NewLine); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            // Rotate once per launch rather than grow without bound.
            if (File.Exists(LogPath) && new FileInfo(LogPath).Length > 2 * 1024 * 1024)
                File.Move(LogPath, LogPath + ".old", overwrite: true);
            process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, args) =>
            {
                if (args.Data is not { } line) return;
                Log(line);
                if (!line.StartsWith("[liuli:ready] ", StringComparison.Ordinal)) return;
                try
                {
                    using var doc = JsonDocument.Parse(line[14..]);
                    var port = doc.RootElement.GetProperty("port").GetInt32();
                    var protocol = doc.RootElement.GetProperty("protocol").GetInt32();
                    if (port is > 0 and <= 65535 && protocol == 1) ready.TrySetResult(port);
                    else ready.TrySetException(new IOException("daemon 协议版本或端口无效。"));
                }
                catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
                { ready.TrySetException(new IOException("daemon 启动响应无效。", ex)); }
            };
            process.ErrorDataReceived += (_, args) => { if (args.Data is { } line) Log(line); };
            process.Exited += (_, _) => ready.TrySetException(new IOException($"daemon 意外退出。日志：{LogPath}"));
            process.Start();
            if (OperatingSystem.IsWindows()) job = new WindowsJob(process);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(45));
            var port = await ready.Task.WaitAsync(timeout.Token);
            Client = new DaemonClient(new Uri($"http://127.0.0.1:{port}/"), token);
            // ok=false means the server is ready but the user has not configured a model.
            await Client.HealthAsync(timeout.Token);
        }
        catch
        {
            Stop();
            throw;
        }
        finally { lifecycle.Release(); }
    }

    private void Stop()
    {
        Client?.Dispose();
        Client = null;
        job?.Dispose();
        job = null;
        if (process is not null)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            process.Dispose();
            process = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await lifecycle.WaitAsync();
        try { Stop(); }
        finally { lifecycle.Release(); }
    }
}
