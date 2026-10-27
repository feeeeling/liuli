using System;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

// Only changes windows owned by the launching Electron process. A persistent
// hidden helper keeps physical-pixel clipping synchronized without spawning on resize.
internal static class WindowChrome {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hwnd, IntPtr region, bool redraw);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    class Request { public string hwnd; public double radius; }
    static void Attribute(IntPtr hwnd, int attribute, int value) { DwmSetWindowAttribute(hwnd, attribute, ref value, sizeof(int)); }
    static void Main(string[] args) {
        uint owner;
        if (args.Length != 1 || !UInt32.TryParse(args[0], out owner)) return;
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
        var json = new JavaScriptSerializer();
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                var request = json.Deserialize<Request>(line);
                long handle;
                if (request == null || !Int64.TryParse(request.hwnd, out handle)) continue;
                var hwnd = new IntPtr(handle);
                uint actualOwner;
                GetWindowThreadProcessId(hwnd, out actualOwner);
                if (actualOwner != owner) continue;
                RECT rect;
                if (!GetWindowRect(hwnd, out rect)) continue;
                uint dpi = GetDpiForWindow(hwnd);
                int diameter = (int)Math.Round(Math.Max(0, Math.Min(48, request.radius)) * Math.Max(96, dpi) / 96 * 2);
                // Disable the separate DWM non-client outline. The card owns its border.
                Attribute(hwnd, 2, 1); // DWMWA_NCRENDERING_POLICY / DWMNCRP_DISABLED
                Attribute(hwnd, 33, 1); // DWMWA_WINDOW_CORNER_PREFERENCE / DONOTROUND
                Attribute(hwnd, 34, unchecked((int)0xFFFFFFFE)); // DWMWA_BORDER_COLOR / NONE
                var region = CreateRoundRectRgn(0, 0, rect.right - rect.left + 1, rect.bottom - rect.top + 1, diameter, diameter);
                int width = rect.right - rect.left, height = rect.bottom - rect.top;
                bool clipped = region != IntPtr.Zero && !PtInRegion(region, 0, 0) && !PtInRegion(region, width - 1, 0)
                    && !PtInRegion(region, 0, height - 1) && !PtInRegion(region, width - 1, height - 1)
                    && PtInRegion(region, width / 2, height / 2);
                bool applied = region != IntPtr.Zero && SetWindowRgn(hwnd, region, true) != 0;
                if (!applied && region != IntPtr.Zero) DeleteObject(region);
                Console.WriteLine(json.Serialize(new { applied, clipped, width, height, dpi }));
            } catch { Console.WriteLine("{\"applied\":false}"); }
        }
    }
}
