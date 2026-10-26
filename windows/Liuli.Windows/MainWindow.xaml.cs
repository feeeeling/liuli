using System.Text.Json;
using Liuli.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace Liuli.Windows;

public sealed partial class MainWindow : Window
{
    private readonly DaemonHost host = new();
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? operation;
    private Uri? loginUri;
    private bool loadingModels;
    private bool busy;
    private bool closing;
    private DaemonClient Client => host.Client ?? throw new IOException("模型服务尚未连接。");

    public MainWindow()
    {
        InitializeComponent();
        Title = "琉璃 Liuli · Windows Preview";
        AppWindow.Resize(new global::Windows.Graphics.SizeInt32(860, 900));
        SystemBackdrop = new DesktopAcrylicBackdrop();
        LogLocation.Text = $"服务日志：{host.LogPath}";
        Root.Loaded += async (_, _) => await StartAsync();
        Closed += async (_, _) =>
        {
            closing = true;
            operation?.Cancel();
            lifetime.Cancel();
            await host.DisposeAsync();
        };
    }

    private void ShowStatus(string text, InfoBarSeverity severity = InfoBarSeverity.Informational)
    {
        if (closing) return;
        Status.Title = text;
        Status.Severity = severity;
    }

    private void SetBusy(bool value, bool cancellable = false)
    {
        busy = value;
        TranslateButton.IsEnabled = !value;
        LoginButton.IsEnabled = !value;
        LogoutButton.IsEnabled = !value;
        RefreshButton.IsEnabled = !value;
        Models.IsEnabled = !value;
        Providers.IsEnabled = !value;
        AuthType.IsEnabled = !value;
        RestartButton.IsEnabled = !value;
        CancelButton.IsEnabled = value && cancellable;
    }

    private async Task StartAsync()
    {
        Workspace.IsEnabled = false;
        SetBusy(true);
        ShowStatus("正在启动模型服务…");
        try
        {
            await host.StartAsync(Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe"),
                Path.Combine(AppContext.BaseDirectory, "daemon", "index.mjs"), ct: lifetime.Token);
            if (closing) return;
            Workspace.IsEnabled = true;
            await RefreshAsync();
        }
        catch (OperationCanceledException) { ShowStatus("模型服务启动超时或已取消。", InfoBarSeverity.Warning); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { if (!closing) SetBusy(false); }
    }

    private async Task RefreshAsync()
    {
        var providers = await Client.ProvidersAsync(lifetime.Token);
        var previous = (Providers.SelectedItem as ProviderInfo)?.Id;
        Providers.ItemsSource = providers.Providers;
        Providers.SelectedItem = providers.Providers.FirstOrDefault(p => p.Id == previous)
            ?? providers.Providers.FirstOrDefault(p => p.Configured) ?? providers.Providers.FirstOrDefault();
        var health = await Client.HealthAsync(lifetime.Token);
        ShowStatus(health.Ok ? $"已连接 · {health.Provider}/{health.Model}" : health.Error ?? "请登录供应商以开始翻译。",
            health.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Warning);
        var models = await Client.ModelsAsync(lifetime.Token);
        loadingModels = true;
        try
        {
            Models.ItemsSource = models.Models;
            Models.SelectedItem = models.Models.FirstOrDefault(m => $"{m.Provider}/{m.Id}" == models.Current);
        }
        finally { loadingModels = false; }
        if (!string.IsNullOrEmpty(models.Warning)) ShowStatus(models.Warning, InfoBarSeverity.Warning);
    }

    private async void RefreshClicked(object sender, RoutedEventArgs e)
    {
        SetBusy(true);
        try { await RefreshAsync(); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { if (!closing) SetBusy(false); }
    }

    private async void ModelChanged(object sender, SelectionChangedEventArgs e)
    {
        if (loadingModels || busy || Models.SelectedItem is not ModelInfo model) return;
        SetBusy(true);
        try
        {
            var health = await Client.SetModelAsync($"{model.Provider}/{model.Id}", lifetime.Token);
            ShowStatus(health.Ok ? $"已切换 · {model.DisplayName}" : health.Error ?? "切换失败。",
                health.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Error);
        }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { if (!closing) SetBusy(false); }
    }

    private async void TranslateClicked(object sender, RoutedEventArgs e)
    {
        if (busy || string.IsNullOrWhiteSpace(Source.Text)) return;
        Result.Text = "";
        SetBusy(true, cancellable: true);
        operation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        operation.CancelAfter(TimeSpan.FromMinutes(5));
        try
        {
            ShowStatus("正在翻译…");
            var target = (Target.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "zh";
            Result.Text = await Client.TranslateAsync(new TaskRequest(Source.Text, target),
                delta => { if (!closing) Result.Text += delta; }, operation.Token);
            ShowStatus("翻译完成。", InfoBarSeverity.Success);
        }
        catch (OperationCanceledException) { ShowStatus("翻译已停止或超时。", InfoBarSeverity.Warning); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { operation.Dispose(); operation = null; if (!closing) SetBusy(false); }
    }

    private void CancelClicked(object sender, RoutedEventArgs e) => operation?.Cancel();

    private void ProviderChanged(object sender, SelectionChangedEventArgs e)
    {
        if (Providers.SelectedItem is not ProviderInfo provider || AuthType is null) return;
        foreach (ComboBoxItem item in AuthType.Items)
            item.IsEnabled = provider.AuthTypes.Contains(item.Tag?.ToString() ?? "");
        AuthType.SelectedItem = AuthType.Items.Cast<ComboBoxItem>().FirstOrDefault(i => i.IsEnabled);
    }

    private async void LoginClicked(object sender, RoutedEventArgs e)
    {
        if (busy || Providers.SelectedItem is not ProviderInfo provider || AuthType.SelectedItem is not ComboBoxItem kind) return;
        var type = kind.Tag?.ToString() ?? "api_key";
        var key = ApiKey.Password;
        ApiKey.Password = "";
        LoginMessage.Text = "";
        LoginLink.Visibility = Visibility.Collapsed;
        loginUri = null;
        SetBusy(true, cancellable: true);
        operation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        operation.CancelAfter(TimeSpan.FromMinutes(10));
        try
        {
            ShowStatus("正在登录…");
            await Client.LoginAsync(provider.Id, type, string.IsNullOrWhiteSpace(key) ? null : key, HandleLoginEventAsync, operation.Token);
            await RefreshAsync();
        }
        catch (OperationCanceledException) { ShowStatus("登录已取消或超时。", InfoBarSeverity.Warning); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { operation.Dispose(); operation = null; if (!closing) SetBusy(false); }
    }

    private async Task HandleLoginEventAsync(SseEvent item)
    {
        var data = item.Data;
        if (data.TryGetProperty("message", out var message)) LoginMessage.Text = message.GetString() ?? "";
        if (data.TryGetProperty("instructions", out var instructions)) LoginMessage.Text += "\n" + instructions.GetString();
        if (data.TryGetProperty("userCode", out var code)) LoginMessage.Text += "\n验证码：" + code.GetString();
        foreach (var field in new[] { "url", "verificationUri" })
        {
            if (data.TryGetProperty(field, out var value) && Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri)
                && uri.Scheme is "https" or "http")
            {
                loginUri = uri;
                LoginLink.Visibility = Visibility.Visible;
                await Launcher.LaunchUriAsync(uri);
                break;
            }
        }
        if (item.Event != "prompt") return;
        var prompt = data.Deserialize<LoginPrompt>(DaemonClient.Json) ?? throw new IOException("登录提问无效。");
        FrameworkElement input = prompt.Type == "select"
            ? new ComboBox { ItemsSource = prompt.Options, DisplayMemberPath = "Label", SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Stretch }
            : prompt.Type == "secret" ? new PasswordBox() : new TextBox { PlaceholderText = prompt.Placeholder ?? "" };
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = prompt.Message,
            Content = input,
            PrimaryButtonText = "继续",
            CloseButtonText = "取消"
        };
        using var registration = operation!.Token.Register(() => DispatcherQueue.TryEnqueue(() => dialog.Hide()));
        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
        {
            operation.Token.ThrowIfCancellationRequested();
            operation.Cancel();
            throw new OperationCanceledException();
        }
        var answer = input switch
        {
            ComboBox combo => (combo.SelectedItem as LoginOption)?.Id ?? "",
            PasswordBox password => password.Password,
            TextBox text => text.Text,
            _ => ""
        };
        await Client.AnswerAsync(prompt.Id, answer, operation.Token);
    }

    private async void LoginLinkClicked(object sender, RoutedEventArgs e)
    {
        if (loginUri is not null) await Launcher.LaunchUriAsync(loginUri);
    }

    private async void LogoutClicked(object sender, RoutedEventArgs e)
    {
        if (busy || Providers.SelectedItem is not ProviderInfo provider) return;
        SetBusy(true);
        try { await Client.LogoutAsync(provider.Id, lifetime.Token); await RefreshAsync(); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { if (!closing) SetBusy(false); }
    }

    private async void RestartClicked(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        SetBusy(true);
        try { await host.DisposeAsync(); await StartAsync(); }
        catch (Exception ex) { ShowStatus(ex.Message, InfoBarSeverity.Error); }
        finally { if (!closing) SetBusy(false); }
    }
}
