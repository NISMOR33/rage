import json
import math
import urllib.request
from bisect import bisect_right
from pathlib import Path

import cv2
import numpy as np

REPLAY_ID = "fbedb96d-68c2-4d6d-a9b9-e12d7f526668"
API = f"https://ragepad-classement.ayoubgor811487.chatgpt.site/api/ragepad/replays/{REPLAY_ID}"
OUTPUT = Path(__file__).with_name("replay-niorixs-116ms.mp4")
WIDTH, HEIGHT, FPS = 960, 540, 30


def download():
    request = urllib.request.Request(
        API,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://aimscientist.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def scale_x(value):
    return int(value / 1000 * WIDTH)


def scale_y(value):
    return int(value / 1000 * HEIGHT)


def rounded_rect(image, p1, p2, color, radius=18, thickness=-1):
    x1, y1 = p1
    x2, y2 = p2
    if thickness != -1:
        cv2.rectangle(image, p1, p2, color, thickness, cv2.LINE_AA)
        return
    radius = max(1, min(radius, (x2 - x1) // 2, (y2 - y1) // 2))
    cv2.rectangle(image, (x1 + radius, y1), (x2 - radius, y2), color, -1)
    cv2.rectangle(image, (x1, y1 + radius), (x2, y2 - radius), color, -1)
    for cx, cy in ((x1 + radius, y1 + radius), (x2 - radius, y1 + radius),
                   (x1 + radius, y2 - radius), (x2 - radius, y2 - radius)):
        cv2.circle(image, (cx, cy), radius, color, -1, cv2.LINE_AA)


def render_frame(frame, current_ms, events, name, value):
    canvas = np.full((HEIGHT, WIDTH, 3), (20, 18, 22), dtype=np.uint8)
    # Bandeau supérieur proche du lecteur du site.
    cv2.rectangle(canvas, (0, 0), (WIDTH, 58), (28, 24, 30), -1)
    cv2.putText(canvas, f"REPLAY  {name}", (24, 27), cv2.FONT_HERSHEY_SIMPLEX,
                .58, (236, 224, 235), 1, cv2.LINE_AA)
    cv2.putText(canvas, f"Reaction  {value:.2f} ms", (24, 49), cv2.FONT_HERSHEY_SIMPLEX,
                .48, (202, 139, 174), 1, cv2.LINE_AA)
    cv2.putText(canvas, f"{current_ms / 1000:05.1f} s", (WIDTH - 105, 35),
                cv2.FONT_HERSHEY_SIMPLEX, .55, (205, 199, 207), 1, cv2.LINE_AA)

    _, cursor_x, cursor_y, mouse_down, targets, _ = frame
    for target in targets:
        x, y, w, h, color_index, _on_target = target
        x1, y1 = scale_x(x), scale_y(y)
        x2, y2 = scale_x(x + w), scale_y(y + h)
        colors = [(34, 31, 35), (225, 222, 224), (203, 142, 174)]
        color = colors[max(0, min(2, int(color_index)))]
        rounded_rect(canvas, (x1, y1), (x2, y2), color, 20)
        cv2.rectangle(canvas, (x1 + 8, y1 + 8), (x2 - 8, y2 - 8),
                      (235, 216, 229), 2, cv2.LINE_AA)
        label_color = (35, 28, 34) if color_index else (225, 215, 222)
        cv2.putText(canvas, "RAGE PAD", (x1 + 22, min(y2 - 18, y1 + 42)),
                    cv2.FONT_HERSHEY_SIMPLEX, .72, label_color, 2, cv2.LINE_AA)

    cx, cy = scale_x(cursor_x), scale_y(cursor_y)
    cursor_color = (80, 210, 255) if mouse_down else (245, 245, 245)
    cv2.circle(canvas, (cx, cy), 7 if mouse_down else 5, cursor_color, 2, cv2.LINE_AA)
    cv2.line(canvas, (cx - 14, cy), (cx - 5, cy), cursor_color, 2, cv2.LINE_AA)
    cv2.line(canvas, (cx + 5, cy), (cx + 14, cy), cursor_color, 2, cv2.LINE_AA)
    cv2.line(canvas, (cx, cy - 14), (cx, cy - 5), cursor_color, 2, cv2.LINE_AA)
    cv2.line(canvas, (cx, cy + 5), (cx, cy + 14), cursor_color, 2, cv2.LINE_AA)

    recent = [e for e in events if 0 <= current_ms - e[0] <= 450 and e[1] == "reaction"]
    if recent:
        text = f"REACTION {recent[-1][2]} ms"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, .85, 2)[0]
        cv2.putText(canvas, text, ((WIDTH - size[0]) // 2, HEIGHT - 38),
                    cv2.FONT_HERSHEY_SIMPLEX, .85, (210, 155, 190), 2, cv2.LINE_AA)
    return canvas


def main():
    data = download()
    replay = data["replay"]
    frames = replay["frames"]
    events = replay["events"]
    times = [frame[0] for frame in frames]
    duration = int(replay.get("duration") or times[-1])
    writer = cv2.VideoWriter(
        str(OUTPUT), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT)
    )
    if not writer.isOpened():
        raise RuntimeError("Le codec MP4 n'a pas pu être initialisé.")
    total = math.ceil(duration / 1000 * FPS)
    try:
        for index in range(total + 1):
            current_ms = min(duration, round(index * 1000 / FPS))
            source_index = max(0, bisect_right(times, current_ms) - 1)
            image = render_frame(frames[source_index], current_ms, events,
                                 data.get("name", "Niorixs"), float(data.get("value", 0)))
            writer.write(image)
    finally:
        writer.release()
    print(OUTPUT)


if __name__ == "__main__":
    main()
