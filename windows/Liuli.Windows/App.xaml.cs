using Microsoft.UI.Xaml;

namespace Liuli.Windows;

public partial class App : Application
{
    private Mutex? instance;
    private MainWindow? window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        instance = new Mutex(true, @"Local\Liuli.Desktop.Windows", out var first);
        if (!first) { instance.Dispose(); Exit(); return; }
        window = new MainWindow();
        window.Closed += (_, _) => { instance.ReleaseMutex(); instance.Dispose(); };
        window.Activate();
    }
}
