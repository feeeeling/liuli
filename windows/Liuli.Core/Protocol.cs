using System.Text.Json;

namespace Liuli.Core;

public sealed record DaemonHealth(bool Ok, string? Model, string? Provider, bool? Vision, string? Error);
public sealed record ProviderInfo(string Id, string Name, string[] AuthTypes, bool Configured, string? LoginLabel);
public sealed record ProvidersResponse(ProviderInfo[] Providers);
public sealed record ModelInfo(string Id, string Provider, string Name, bool Vision)
{
    public string DisplayName => $"{Provider} / {Name}";
}
public sealed record ModelsResponse(string? Current, string? Warning, ModelInfo[] Models);
public sealed record TaskRequest(string Text, string TargetLang = "zh", string Mode = "translate", string Action = "task");
public sealed record LoginOption(string Id, string Label, string? Description);
public sealed record LoginPrompt(string Id, string Type, string Message, string? Placeholder, LoginOption[]? Options);
public sealed record SseEvent(string Event, JsonElement Data);

public static class SseReader
{
    public static async IAsyncEnumerable<SseEvent> ReadAsync(Stream stream,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var name = "message";
        var data = new List<string>();
        while (true)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line is null || line.Length == 0)
            {
                if (data.Count > 0)
                {
                    using var document = JsonDocument.Parse(string.Join("\n", data));
                    yield return new SseEvent(name, document.RootElement.Clone());
                }
                if (line is null) yield break;
                name = "message";
                data.Clear();
                continue;
            }
            if (line.StartsWith(':')) continue;
            var colon = line.IndexOf(':');
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? "" : line[(colon + 1)..];
            if (value.StartsWith(' ')) value = value[1..];
            if (field == "event") name = value;
            if (field == "data") data.Add(value);
        }
    }
}
