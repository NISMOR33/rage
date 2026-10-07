using System.Runtime.InteropServices;
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

    private const uint InputMouse = 0;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;

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
                if (request.Type != "click")
                    throw new InvalidOperationException("Commande inconnue.");
                bool positioned = false;
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    if (!SetCursorPos(request.X, request.Y)) continue;
                    if (GetCursorPos(out POINT point) && point.X == request.X && point.Y == request.Y)
                    {
                        positioned = true;
                        break;
                    }
                }
                if (!positioned)
                    throw new InvalidOperationException("Le curseur Windows n'a pas atteint la cible.");

                var events = new[]
                {
                    new INPUT { type = InputMouse, data = new InputUnion { mouse = new MOUSEINPUT { flags = MouseLeftDown } } },
                    new INPUT { type = InputMouse, data = new InputUnion { mouse = new MOUSEINPUT { flags = MouseLeftUp } } }
                };
                if (SendInput((uint)events.Length, events, Marshal.SizeOf<INPUT>()) != events.Length)
                    throw new InvalidOperationException("SendInput a echoue.");
                response = new Response(request.Id, true, null);
            }
            catch (Exception error)
            {
                response = new Response(requestId, false, error.Message);
            }
            await WriteMessage(output, response);
        }
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

    private sealed record Request(long Id, string Type, int X, int Y);
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
