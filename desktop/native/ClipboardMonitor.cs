using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ClipboardMonitor {
    [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr value);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr value);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr value);
    static readonly object outputLock = new object();
    static volatile bool enabled;
    static volatile uint seen;
    static void Output(object value) {
        lock (outputLock) Console.WriteLine(new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 }.Serialize(value));
    }
    static byte[] ReadBytes(uint format, int maximum) {
        var handle = GetClipboardData(format);
        long size = (long)GlobalSize(handle).ToUInt64();
        if (handle == IntPtr.Zero || size < 1 || size > maximum) return null;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try { var bytes = new byte[(int)size]; Marshal.Copy(pointer, bytes, 0, bytes.Length); return bytes; }
        finally { GlobalUnlock(handle); }
    }
    static byte[] Png(Image image) {
        using (var bytes = new MemoryStream()) { image.Save(bytes, ImageFormat.Png); return bytes.ToArray(); }
    }
    static string Thumbnail(Image image) {
        double scale = Math.Min(1, 64.0 / Math.Max(image.Width, image.Height));
        using (var thumbnail = new Bitmap(Math.Max(1, (int)(image.Width * scale)), Math.Max(1, (int)(image.Height * scale)))) {
            using (var graphics = Graphics.FromImage(thumbnail)) {
                graphics.Clear(Color.Transparent); graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(image, 0, 0, thumbnail.Width, thumbnail.Height);
            }
            return Convert.ToBase64String(Png(thumbnail));
        }
    }
    static bool SizeAllowed(Image image) { return image.Width <= 16384 && image.Height <= 16384 && (long)image.Width * image.Height <= 33554432; }
    class Command { public string op; public int id; public bool value; }
    sealed class Listener : NativeWindow, IDisposable {
        readonly System.Windows.Forms.Timer retry = new System.Windows.Forms.Timer { Interval = 40 };
        readonly uint exclude = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
        readonly uint include = RegisterClipboardFormat("CanIncludeInClipboardHistory");
        readonly uint htmlFormat = RegisterClipboardFormat("HTML Format");
        readonly uint pngFormat = RegisterClipboardFormat("PNG");
        uint attempted; int attempts;
        public Listener() {
            CreateHandle(new CreateParams { Caption = "Liuli Clipboard Listener", Parent = new IntPtr(-3) });
            if (!AddClipboardFormatListener(Handle)) throw new InvalidOperationException("Clipboard listener unavailable");
            retry.Tick += (sender, args) => { retry.Stop(); Read(); };
        }
        void Read() {
            uint sequence = GetClipboardSequenceNumber();
            if (!enabled || sequence == seen) return;
            if (attempted != sequence) { attempted = sequence; attempts = 0; }
            try {
                if (!OpenClipboard(Handle)) throw new ExternalException();
                string text = "", html = ""; byte[] png = null; bool bitmap = false;
                IntPtr owner;
                try {
                    if (IsClipboardFormatAvailable(exclude)) { seen = sequence; return; }
                    if (IsClipboardFormatAvailable(include)) {
                        var flag = ReadBytes(include, 32);
                        if (flag == null || flag.Length < 4 || BitConverter.ToUInt32(flag, 0) != 1) { seen = sequence; return; }
                    }
                    if (IsClipboardFormatAvailable(13)) {
                        var bytes = ReadBytes(13, 2 * 1024 * 1024 + 2);
                        if (bytes == null) { seen = sequence; return; }
                        text = Encoding.Unicode.GetString(bytes).TrimEnd('\0');
                    }
                    if (IsClipboardFormatAvailable(htmlFormat)) {
                        var bytes = ReadBytes(htmlFormat, 2 * 1024 * 1024);
                        if (bytes != null) html = Encoding.UTF8.GetString(bytes).TrimEnd('\0');
                    }
                    if (IsClipboardFormatAvailable(pngFormat)) png = ReadBytes(pngFormat, 8 * 1024 * 1024);
                    bitmap = IsClipboardFormatAvailable(2) || IsClipboardFormatAvailable(8) || IsClipboardFormatAvailable(17);
                    owner = GetClipboardOwner();
                } finally { CloseClipboard(); }
                string thumbnail = null; int width = 0, height = 0;
                if (png != null) {
                    if (png.Length < 24 || png[0] != 137 || png[1] != 80 || png[2] != 78 || png[3] != 71) { seen = sequence; return; }
                    uint w = ((uint)png[16] << 24) | ((uint)png[17] << 16) | ((uint)png[18] << 8) | png[19];
                    uint h = ((uint)png[20] << 24) | ((uint)png[21] << 16) | ((uint)png[22] << 8) | png[23];
                    if (w > 16384 || h > 16384 || (long)w * h > 33554432) { seen = sequence; return; }
                    using (var stream = new MemoryStream(png)) using (var image = Image.FromStream(stream)) {
                        width = image.Width; height = image.Height; thumbnail = Thumbnail(image);
                    }
                } else if (bitmap) {
                    using (var image = Clipboard.GetImage()) if (image != null && SizeAllowed(image)) {
                        png = Png(image); width = image.Width; height = image.Height;
                        if (png.Length <= 8 * 1024 * 1024) thumbnail = Thumbnail(image); else png = null;
                    }
                }
                if (!enabled) return;
                if (GetClipboardSequenceNumber() != sequence) { retry.Start(); return; }
                seen = sequence;
                if (text.Length == 0 && html.Length == 0 && png == null) return;
                string source = "";
                try {
                    uint pid; GetWindowThreadProcessId(owner != IntPtr.Zero ? owner : GetForegroundWindow(), out pid);
                    source = Process.GetProcessById((int)pid).ProcessName;
                } catch { }
                Output(new { kind = "snapshot", sequence, data = new { text, html, sourceApp = source,
                    pngBase64 = png == null ? null : Convert.ToBase64String(png), thumbnail, width, height } });
            } catch {
                if (++attempts < 8) retry.Start(); else seen = sequence;
            }
        }
        protected override void WndProc(ref Message message) {
            if (message.Msg == 0x031D) Read();
            if (message.Msg == 0x0010) { Dispose(); Application.ExitThread(); return; }
            base.WndProc(ref message);
        }
        public void Dispose() { retry.Dispose(); if (Handle != IntPtr.Zero) { RemoveClipboardFormatListener(Handle); DestroyHandle(); } }
    }
    [STAThread] static void Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        enabled = args.Length > 0 && args[0] == "1";
        seen = GetClipboardSequenceNumber();
        using (var listener = new Listener()) {
            var handle = listener.Handle;
            new Thread(() => {
                string line;
                while ((line = Console.ReadLine()) != null) try {
                    var command = new JavaScriptSerializer().Deserialize<Command>(line);
                    if (command.op == "enabled") { seen = GetClipboardSequenceNumber(); enabled = command.value; Output(new { kind = "ack", id = command.id, value = true }); }
                    if (command.op == "foreground") {
                        var hwnd = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(hwnd, out pid);
                        Output(new { kind = "ack", id = command.id, value = new { hwnd = hwnd.ToInt64().ToString(), pid } });
                    }
                } catch { }
                PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero);
            }) { IsBackground = true }.Start();
            Output(new { kind = "ready" });
            Application.Run();
        }
    }
}
