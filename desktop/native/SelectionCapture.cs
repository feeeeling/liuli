using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// Runs without a window, before Liuli activates its panel. No document-wide text is read.
internal static class SelectionCapture
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] input, int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {
        public ushort key, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    static INPUT Key(ushort key, bool up) {
        return new INPUT { type = 1, data = new INPUTUNION {
            keyboard = new KEYBDINPUT { key = key, flags = up ? 2u : 0u }
        }};
    }

    [STAThread]
    static void Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length >= 4 && args[0] == "--restore") {
                var target = new IntPtr(Int64.Parse(args[1]));
                uint expected = UInt32.Parse(args[2]), actual;
                var sender = new IntPtr(Int64.Parse(args[3]));
                WaitForModifiers();
                var current = GetForegroundWindow();
                GetWindowThreadProcessId(target, out actual);
                bool restored = IsWindow(target) && actual == expected && (current == sender || current == target);
                if (restored && IsIconic(target)) ShowWindow(target, 9);
                if (restored) {
                    restored = IsWindowVisible(target) && (current == target || SetForegroundWindow(target));
                    Thread.Sleep(35);
                    restored = restored && GetForegroundWindow() == target;
                }
                Console.Write(new JavaScriptSerializer().Serialize(new { restored }));
                return;
            }
            var foreground = GetForegroundWindow();
            string selected = null;
            bool password = false;
            bool focusChecked = false;
            // A broken accessibility provider must not hold the shortcut indefinitely.
            var reader = new Thread(() => {
                try {
                    var element = AutomationElement.FocusedElement;
                    if (element == null) return;
                    password = element.Current.IsPassword;
                    focusChecked = true;
                    if (password) return;
                    for (int i = 0; element != null && i < 5; i++) {
                        object pattern;
                        if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                            var text = new StringBuilder();
                            foreach (var range in ((TextPattern)pattern).GetSelection())
                                text.Append(range.GetText(100000));
                            if (!String.IsNullOrWhiteSpace(text.ToString())) {
                                selected = text.ToString();
                                return;
                            }
                        }
                        element = TreeWalker.ControlViewWalker.GetParent(element);
                    }
                } catch { }
            });
            reader.IsBackground = true;
            reader.SetApartmentState(ApartmentState.MTA);
            reader.Start();
            reader.Join(650);
            if (password) throw new InvalidOperationException("不能读取密码输入框。");
            if (GetForegroundWindow() != foreground)
                throw new InvalidOperationException("当前应用已切换，请重新选择文字后按快捷键。");
            if (args.Length == 0 && !String.IsNullOrWhiteSpace(selected)) {
                Write(selected, "accessibility", null);
                return;
            }
            if (!focusChecked)
                throw new InvalidOperationException("当前应用无法读取选中文字，请使用卡片中的粘贴文本。");
            uint owner;
            GetWindowThreadProcessId(foreground, out owner);
            string processName = Process.GetProcessById((int)owner).ProcessName.ToLowerInvariant();
            // Ctrl+C interrupts jobs in terminals; only use their accessibility selection.
            if (Array.IndexOf(new[] { "windowsterminal", "openconsole", "conhost", "cmd", "powershell", "pwsh", "mintty", "wezterm-gui", "alacritty" }, processName) >= 0)
                throw new InvalidOperationException("终端未提供选中文字，请复制后使用卡片中的粘贴文本。");
            selected = CopySelection(foreground);
            if (String.IsNullOrWhiteSpace(selected))
                throw new InvalidOperationException("未读取到选中文字，请先选中文字再按划词快捷键。");
            Write(selected, "copy", null);
        } catch (Exception error) {
            Write(null, null, error.Message);
        }
    }

    static string CopySelection(IntPtr foreground)
    {
        // Release shortcut modifiers before synthesizing Ctrl+C.
        WaitForModifiers();
        var timer = Stopwatch.StartNew();
        if (GetForegroundWindow() != foreground)
            throw new InvalidOperationException("当前应用已切换，请重试。");

        // Materialize every native format before copying; keeping IDataObject alone
        // can refer to the new clipboard contents after the source owner changes.
        var backup = new DataObject();
        var original = ClipboardRead(() => Clipboard.GetDataObject());
        if (original != null) {
            foreach (string format in ClipboardRead(() => original.GetFormats(false))) {
                // OLE bookkeeping contains process-local handles, not user data.
                if (format == "DataObject" || format == "Ole Private Data") continue;
                object value = ClipboardRead(() => original.GetData(format, false));
                var stream = value as Stream;
                if (stream != null) {
                    var copy = new MemoryStream();
                    long position = stream.CanSeek ? stream.Position : 0;
                    if (stream.CanSeek) stream.Position = 0;
                    stream.CopyTo(copy);
                    if (stream.CanSeek) stream.Position = position;
                    copy.Position = 0;
                    value = copy;
                } else if (value is System.Drawing.Image) {
                    value = ((System.Drawing.Image)value).Clone();
                }
                if (value != null) backup.SetData(format, false, value);
            }
        }
        uint before = GetClipboardSequenceNumber(), copied = before;
        try {
            if (GetForegroundWindow() != foreground)
                throw new InvalidOperationException("当前应用已切换，请重试。");
            var keys = new[] { Key(0x11, false), Key(0x43, false), Key(0x43, true), Key(0x11, true) };
            if (SendInput(4, keys, Marshal.SizeOf(typeof(INPUT))) != 4)
                throw new InvalidOperationException("当前应用无法复制选中文字，请使用卡片中的粘贴文本。");
            timer.Restart();
            while (timer.ElapsedMilliseconds < 650) {
                Thread.Sleep(20);
                if (GetForegroundWindow() != foreground)
                    throw new InvalidOperationException("当前应用已切换，请重试。");
                copied = GetClipboardSequenceNumber();
                try {
                    if (copied != before && Clipboard.ContainsText(TextDataFormat.UnicodeText)) {
                        string text = Clipboard.GetText(TextDataFormat.UnicodeText);
                        copied = GetClipboardSequenceNumber();
                        return text;
                    }
                } catch (ExternalException) { }
            }
            return null; // Never use pre-existing clipboard text as a selection.
        } finally {
            // Preserve any newer copy made by the user or another application.
            if (copied != before && GetClipboardSequenceNumber() == copied) {
                if (backup.GetFormats(false).Length == 0) Clipboard.Clear();
                else Clipboard.SetDataObject(backup, true, 10, 50);
            }
        }
    }

    static void WaitForModifiers()
    {
        var timer = Stopwatch.StartNew();
        while ((GetAsyncKeyState(0x12) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x11) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x10) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x5B) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x5C) & 0x8000) != 0) {
            if (timer.ElapsedMilliseconds > 1800)
                throw new InvalidOperationException("请松开快捷键后重试。");
            Thread.Sleep(15);
        }
    }
    static T ClipboardRead<T>(Func<T> read) {
        for (int attempt = 0; ; attempt++) {
            try { return read(); }
            catch (ExternalException) { if (attempt >= 8) throw; Thread.Sleep(25); }
        }
    }
    static void Write(string text, string method, string error) {
        Console.Write(new JavaScriptSerializer().Serialize(new { text, method, error }));
    }
}
