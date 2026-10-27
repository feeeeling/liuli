using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class ScreenCapture {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    static int Main(string[] args) {
        try {
            if (args.Length != 4) throw new ArgumentException("Invalid capture bounds");
            int x = Int32.Parse(args[0]), y = Int32.Parse(args[1]);
            int width = Int32.Parse(args[2]), height = Int32.Parse(args[3]);
            if (width < 1 || height < 1 || width > 16384 || height > 16384 || (long)width * height > 33554432)
                throw new ArgumentException("Capture is too large");
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
            // Selection overlays are fully transparent. Let the compositor
            // present the live desktop before copying just this region.
            DwmFlush();
            Thread.Sleep(32);
            using (var image = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                using (var graphics = Graphics.FromImage(image)) {
                    var source = GetDC(IntPtr.Zero);
                    var target = graphics.GetHdc();
                    try {
                        // CAPTUREBLT includes layered/always-on-top windows.
                        if (source == IntPtr.Zero || !BitBlt(target, 0, 0, width, height, source, x, y, 0x40CC0020))
                            throw new InvalidOperationException("Unable to read desktop pixels");
                    } finally {
                        graphics.ReleaseHdc(target);
                        if (source != IntPtr.Zero) ReleaseDC(IntPtr.Zero, source);
                    }
                }
                using (var bytes = new MemoryStream()) {
                    image.Save(bytes, ImageFormat.Png);
                    Console.Write(Convert.ToBase64String(bytes.ToArray()));
                }
            }
            return 0;
        } catch (Exception error) {
            Console.Error.Write(error.Message);
            return 1;
        }
    }
}
