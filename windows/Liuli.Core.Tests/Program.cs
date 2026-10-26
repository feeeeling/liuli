using System.Diagnostics;
using System.Net;
using System.Text;
using Liuli.Core;

static void Check(bool value, string message)
{
    if (!value) throw new Exception(message);
}
static async Task ThrowsAsync<T>(Func<Task> action) where T : Exception
{
    try { await action(); }
    catch (T) { return; }
    throw new Exception($"Expected {typeof(T).Name}");
}

// No test package dependencies: this executable fails CI with a nonzero exit code.
await using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(": heartbeat\r\nevent: delta\r\ndata: {\r\ndata: \"text\":\"中文\"}\r\n\r\nevent: done\ndata: {}")))
{
    var events = new List<SseEvent>();
    await foreach (var item in SseReader.ReadAsync(stream)) events.Add(item);
    Check(events.Count == 2 && events[0].Data.GetProperty("text").GetString() == "中文", "SSE must handle CRLF, multiline JSON, Unicode and EOF.");
    Check(events[1].Event == "done", "Terminal event missing.");
}
using (var client = new DaemonClient(new Uri("http://127.0.0.1:1234/"), "token", new StubHandler("event: delta\ndata: {\"text\":\"partial\"}\n\n")))
    await ThrowsAsync<IOException>(() => client.TranslateAsync(new TaskRequest("hello"), _ => {}));
using (var client = new DaemonClient(new Uri("http://127.0.0.1:1234/"), "token", new StubHandler("event: error\ndata: {\"message\":\"bad model\"}\n\n")))
    await ThrowsAsync<IOException>(() => client.TranslateAsync(new TaskRequest("hello"), _ => {}));
Console.WriteLine("PASS: SSE parsing, authentication header, request serialization and incomplete/error streams");

if (args.Length != 3) throw new ArgumentException("Expected node, bundled daemon entry, and TS fixture paths.");
var temp = Path.Combine(Path.GetTempPath(), "liuli-contract-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
var environment = new Dictionary<string, string>
{
    ["HOME"] = temp, ["USERPROFILE"] = temp, ["PI_CODING_AGENT_DIR"] = Path.Combine(temp, ".pi", "agent"),
    ["PI_OFFLINE"] = "1", ["LIULI_PROXY_PORTS"] = "0"
};
try
{
    int pid;
    await using (var host = new DaemonHost(Path.Combine(temp, "logs")))
    {
        await host.StartAsync(Path.GetFullPath(args[0]), Path.GetFullPath(args[2]), environment, inheritEnvironment: false);
        var client = host.Client!;
        var health = await client.HealthAsync();
        pid = int.Parse(health.Model!);
        Check((await client.ProvidersAsync()).Providers[0].Id == "fixture", "Providers contract failed.");
        Check((await client.ModelsAsync()).Models[0].Id == "model", "Models contract failed.");
        Check((await client.SetModelAsync("fixture/model")).Ok, "Model selection failed.");
        var partial = "";
        var result = await client.TranslateAsync(new TaskRequest("hello"), delta => partial += delta);
        Check(partial == "你好，世界" && result == "你好，世界 (0)", "Streaming contract or request-close lifecycle failed.");
        await ThrowsAsync<IOException>(() => client.TranslateAsync(new TaskRequest("error"), _ => {}));
        var prompted = false;
        await client.LoginAsync("fixture", "oauth", null, async item =>
        {
            if (item.Event != "prompt") return;
            prompted = true;
            await client.AnswerAsync(item.Data.GetProperty("id").GetString()!, "code");
        });
        Check(prompted, "Interactive login event missing.");
        await client.LogoutAsync("fixture");
        using var cancel = new CancellationTokenSource(150);
        await ThrowsAsync<OperationCanceledException>(() => client.TranslateAsync(new TaskRequest("wait"), _ => {}, cancel.Token));
    }
    await Task.Delay(200);
    try { using var child = Process.GetProcessById(pid); Check(child.HasExited, "Daemon survived host disposal."); }
    catch (ArgumentException) { }
    Console.WriteLine("PASS: real HTTP/SSE client, interactive login, cancellation, owned child cleanup");

    // Launch the actual production bundle with no accounts. Initialization must not require a model or Pi CLI.
    await using (var production = new DaemonHost(Path.Combine(temp, "production-logs")))
    {
        await production.StartAsync(Path.GetFullPath(args[0]), Path.GetFullPath(args[1]), environment, inheritEnvironment: false);
        var health = await production.Client!.HealthAsync();
        Check(!health.Ok, "Isolated production daemon should have no configured credentials.");
        Check((await production.Client.ProvidersAsync()).Providers.Length > 0, "Production SDK providers unavailable.");
    }
    Console.WriteLine("PASS: production bundle starts without user credentials, global Node or Pi CLI");
}
finally { Directory.Delete(temp, recursive: true); }

sealed class StubHandler(string events) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (request.Headers.Authorization?.ToString() != "Bearer token") throw new Exception("Missing authentication");
        if (request.RequestUri?.AbsolutePath != "/v1/task") throw new Exception("Wrong route");
        var body = await request.Content!.ReadAsStringAsync(ct);
        if (!body.Contains("\"targetLang\":\"zh\"") || !body.Contains("\"mode\":\"translate\"")) throw new Exception("Wrong JSON contract");
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(events, Encoding.UTF8, "text/event-stream") };
    }
}
