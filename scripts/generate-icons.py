"""Generate PNG versions of the app icon using only Python's standard library."""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"


def inside_polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def pixel(x, y):
    purple, dark, groove = (168, 139, 249), (33, 19, 50), (72, 50, 93)
    pink, cream, lime = (243, 165, 191), (255, 248, 233), (223, 255, 121)
    distance = math.hypot(x - 256, y - 256)
    color = purple
    if distance < 189:
        color = dark
    if abs(distance - 151) < 1.5 or abs(distance - 119) < 1.5:
        color = groove
    if distance < 81:
        color = pink
    if (247 <= x <= 259 and 158 <= y <= 280 or
        310 <= x <= 322 and 141 <= y <= 247 or
        inside_polygon(x, y, [(247, 158), (322, 141), (322, 160), (247, 177)]) or
        ((x - 223) / 33) ** 2 + ((y - 296) / 25) ** 2 < 1 or
        ((x - 286) / 33) ** 2 + ((y - 262) / 25) ** 2 < 1):
        color = cream
    if inside_polygon(x, y, [(380, 82), (388, 106), (412, 114), (388, 122), (380, 146), (372, 122), (348, 114), (372, 106)]) or math.hypot(x - 120, y - 372) < 12:
        color = lime
    return color


def write_png(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [pixel((x + dx) * 512 / size, (y + dy) * 512 / size)
                       for dx, dy in ((.25, .25), (.75, .25), (.25, .75), (.75, .75))]
            rows.extend(sum(sample[channel] for sample in samples) // 4 for channel in range(3))

    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))

    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
    (ROOT / f"icon-{size}.png").write_bytes(png)


for icon_size in (192, 512):
    write_png(icon_size)
