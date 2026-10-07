using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private static readonly JsonSerializerOptions InputJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    private const uint InputMouse = 0;
    private const uint MouseMove = 0x0001;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint MouseVirtualDesk = 0x4000;
    private const uint MouseAbsolute = 0x8000;
    private const int SmXVirtualScreen = 76;
    private const int SmYVirtualScreen = 77;
    private const int SmCxVirtualScreen = 78;
    private const int SmCyVirtualScreen = 79;
    private static readonly Stopwatch LogClock = Stopwatch.StartNew();
    private static StreamWriter? LogWriter;
    private static long LastRequestAt;
    private static long LastLogAt;
    private static int LoggedBatches;
    private static int LoggedClicks;
    private static long MaxGapMs;

    private static async Task Main()
    {
        using Stream input = Console.OpenStandardInput();
        using Stream output = Console.OpenStandardOutput();
        while (true)
        {
            byte[] lengthBytes = new byte[4];
            if (!await ReadExact(input, lengthBytes)) break;
            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length <= 0 || length > 1024 * 1024) break;

            byte[] payload = new byte[length];
            if (!await ReadExact(input, payload)) break;

            Response response;
            long requestId = 0;
            try
            {
                Request? request = JsonSerializer.Deserialize<Request>(payload, InputJsonOptions);
                if (request is null)
                    throw new InvalidOperationException("Commande inconnue.");
                requestId = request.Id;
                List<ClickPoint> points = request.Type switch
                {
                    "click" => [new ClickPoint(request.X, request.Y)],
                    "batch" when request.Points is { Count: > 0 } => request.Points,
                    _ => throw new InvalidOperationException("Commande inconnue.")
                };
                var operationClock = Stopwatch.StartNew();
                ExecuteBatch(points);
                RecordBatch(points.Count, operationClock.Elapsed.TotalMilliseconds);
                response = new Response(request.Id, true, null);
            }
            catch (Exception error)
            {
                RecordError(error.Message);
                response = new Response(requestId, false, error.Message);
            }
            await WriteMessage(output, response);
        }
        LogWriter?.Dispose();
    }

    private static void ExecuteBatch(List<ClickPoint> points)
    {
        int left = GetSystemMetrics(SmXVirtualScreen);
        int top = GetSystemMetrics(SmYVirtualScreen);
        int width = Math.Max(2, GetSystemMetrics(SmCxVirtualScreen));
        int height = Math.Max(2, GetSystemMetrics(SmCyVirtualScreen));
        foreach (ClickPoint point in points)
        {
            int absoluteX = (int)Math.Round((point.X - left) * 65535.0 / (width - 1));
            int absoluteY = (int)Math.Round((point.Y - top) * 65535.0 / (height - 1));
            INPUT[] clickEvents =
            [
                new INPUT { type = InputMouse, data = new InputUnion { mouse = new MOUSEINPUT { dx = absoluteX, dy = absoluteY, flags = MouseMove | MouseAbsolute | MouseVirtualDesk } } },
                new INPUT { type = InputMouse, data = new InputUnion { mouse = new MOUSEINPUT { flags = MouseLeftDown } } },
                new INPUT { type = InputMouse, data = new InputUnion { mouse = new MOUSEINPUT { flags = MouseLeftUp } } }
            ];
            if (SendInput((uint)clickEvents.Length, clickEvents, Marshal.SizeOf<INPUT>()) != clickEvents.Length)
                throw new InvalidOperationException("SendInput a echoue.");
            // Laisser Windows livrer le clic a Chrome avant le prochain
            // deplacement, sinon les mouvements peuvent etre fusionnes.
            Thread.Sleep(4);
        }
    }

    private static void RecordBatch(int clicks, double durationMs)
    {
        try
        {
            long now = LogClock.ElapsedMilliseconds;
            if (LastRequestAt > 0) MaxGapMs = Math.Max(MaxGapMs, now - LastRequestAt);
            LastRequestAt = now;
            LoggedBatches++;
            LoggedClicks += clicks;
            if (now - LastLogAt < 1000) return;
            LogWriter ??= CreateLogWriter();
            LogWriter.WriteLine($"{DateTimeOffset.Now:O} batches={LoggedBatches} clicks={LoggedClicks} maxGapMs={MaxGapMs} lastBatchMs={durationMs:F2}");
            LogWriter.Flush();
            LoggedBatches = LoggedClicks = 0;
            MaxGapMs = 0;
            LastLogAt = now;
        }
        catch { }
    }

    private static StreamWriter CreateLogWriter()
    {
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VisionHoldClicker");
        Directory.CreateDirectory(directory);
        return new StreamWriter(Path.Combine(directory, "bot.log"), append: true, Encoding.UTF8);
    }

    private static void RecordError(string message)
    {
        try
        {
            LogWriter ??= CreateLogWriter();
            LogWriter.WriteLine($"{DateTimeOffset.Now:O} ERROR {message}");
            LogWriter.Flush();
        }
        catch { }
    }

    private static async Task<bool> ReadExact(Stream stream, byte[] buffer)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(offset));
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    private static async Task WriteMessage(Stream stream, Response response)
    {
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(response, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
        await stream.WriteAsync(BitConverter.GetBytes(json.Length));
        await stream.WriteAsync(json);
        await stream.FlushAsync();
    }

    private sealed record Request(long Id, string Type, int X, int Y, List<ClickPoint>? Points);
    private sealed record ClickPoint(int X, int Y);
    private sealed record Response(long Id, bool Ok, string? Error);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion data; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mouse; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public nuint extraInfo;
    }
}
