using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Liuli.Core;

public sealed class DaemonClient : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;

    public DaemonClient(Uri address, string token, HttpMessageHandler? handler = null)
    {
        if (!address.IsLoopback || address.Scheme != "http")
            throw new ArgumentException("Daemon address must be loopback HTTP.", nameof(address));
        http = new HttpClient(handler ?? new HttpClientHandler { UseProxy = false })
        {
            BaseAddress = address,
            Timeout = Timeout.InfiniteTimeSpan
        };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public Task<DaemonHealth> HealthAsync(CancellationToken ct = default) => GetAsync<DaemonHealth>("v1/health", ct);
    public Task<ProvidersResponse> ProvidersAsync(CancellationToken ct = default) => GetAsync<ProvidersResponse>("v1/providers", ct);
    public Task<ModelsResponse> ModelsAsync(CancellationToken ct = default) => GetAsync<ModelsResponse>("v1/models", ct);
    public Task<DaemonHealth> SetModelAsync(string id, CancellationToken ct = default) => PostAsync<DaemonHealth>("v1/model", new { id }, ct);
    public async Task AbortAsync(CancellationToken ct = default) => _ = await PostAsync<JsonElement>("v1/abort", new { }, ct);
    public async Task CancelLoginAsync(CancellationToken ct = default) => _ = await PostAsync<JsonElement>("v1/auth/cancel", new { }, ct);
    public async Task AnswerAsync(string id, string value, CancellationToken ct = default) =>
        _ = await PostAsync<JsonElement>("v1/auth/answer", new { id, value }, ct);
    public async Task LogoutAsync(string providerId, CancellationToken ct = default) =>
        _ = await PostAsync<JsonElement>("v1/auth/logout", new { providerId }, ct);

    private async Task<T> GetAsync<T>(string path, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.GetAsync(path, timeout.Token);
        await CheckAsync(response, timeout.Token);
        return await response.Content.ReadFromJsonAsync<T>(Json, timeout.Token)
            ?? throw new IOException("守护进程返回空响应。");
    }

    private async Task<T> PostAsync<T>(string path, object body, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.PostAsJsonAsync(path, body, Json, timeout.Token);
        await CheckAsync(response, timeout.Token);
        return await response.Content.ReadFromJsonAsync<T>(Json, timeout.Token)
            ?? throw new IOException("守护进程返回空响应。");
    }

    public async Task<string> TranslateAsync(TaskRequest task, Action<string> onDelta, CancellationToken ct = default)
    {
        var result = "";
        var complete = false;
        await StreamAsync("v1/task", task, item =>
        {
            if (item.Event == "delta")
            {
                var delta = item.Data.GetProperty("text").GetString() ?? "";
                result += delta;
                onDelta(delta);
            }
            if (item.Event == "done")
            {
                complete = true;
                result = item.Data.GetProperty("text").GetString() ?? result;
            }
            return Task.CompletedTask;
        }, ct);
        if (!complete) throw new IOException("连接中断，翻译未完成。请重试。");
        return result;
    }

    public async Task LoginAsync(string providerId, string type, string? apiKey,
        Func<SseEvent, Task> onEvent, CancellationToken ct = default)
    {
        var complete = false;
        await StreamAsync("v1/auth/login", new { providerId, type, apiKey }, async item =>
        {
            if (item.Event == "done") complete = true;
            await onEvent(item);
        }, ct);
        if (!complete) throw new IOException("登录连接中断。请重试。");
    }

    private async Task StreamAsync(string path, object body, Func<SseEvent, Task> onEvent, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body, options: Json) };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        await CheckAsync(response, ct);
        if (response.Content.Headers.ContentType?.MediaType != "text/event-stream")
            throw new IOException("守护进程没有返回事件流。");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        await foreach (var item in SseReader.ReadAsync(stream, ct))
        {
            if (item.Event == "error")
                throw new IOException(item.Data.TryGetProperty("message", out var message) ? message.GetString() : "守护进程错误。");
            await onEvent(item);
        }
    }

    private static async Task CheckAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync(ct);
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error)) body = error.GetString() ?? body;
        }
        catch (JsonException) { }
        throw new HttpRequestException($"守护进程 HTTP {(int)response.StatusCode}：{body[..Math.Min(body.Length, 300)]}", null, response.StatusCode);
    }

    public void Dispose() => http.Dispose();
}
