#!/usr/bin/env python3
"""Generate the ProphetGrid 512x512 logo without third party dependencies.

The renderer is a small supersampled rasterizer that writes a plain RGB PNG
through zlib. Supersampling keeps the lattice and the ring crisp at 44 px in
the application header while the source file stays a single 512 px asset.
"""

from __future__ import annotations

import math
import struct
import zlib
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIZE = 512
SCALE = 3
W = SIZE * SCALE
N = W * W

OBSIDIAN = (7.0, 11.0, 20.0)
PANEL = (11.0, 18.0, 32.0)
LINE = (27.0, 39.0, 64.0)
YES = (52.0, 211.0, 153.0)
NO = (34.0, 211.0, 238.0)
AMBER = (251.0, 191.0, 36.0)
INK = (230.0, 237.0, 247.0)

red = array("f", [0.0]) * N
green = array("f", [0.0]) * N
blue = array("f", [0.0]) * N


def blend(index: int, color: tuple[float, float, float], alpha: float) -> None:
    if alpha <= 0.0:
        return
    if alpha > 1.0:
        alpha = 1.0
    red[index] = red[index] * (1.0 - alpha) + color[0] * alpha
    green[index] = green[index] * (1.0 - alpha) + color[1] * alpha
    blue[index] = blue[index] * (1.0 - alpha) + color[2] * alpha


def clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def paint(x0: int, y0: int, x1: int, y1: int, shader) -> None:
    for y in range(max(0, y0), min(W, y1)):
        row = y * W
        for x in range(max(0, x0), min(W, x1)):
            color, alpha = shader(x + 0.5, y + 0.5)
            if alpha > 0.0:
                blend(row + x, color, alpha)


def sdf_rounded_rect(px: float, py: float, cx: float, cy: float, half: float, radius: float) -> float:
    qx = abs(px - cx) - (half - radius)
    qy = abs(py - cy) - (half - radius)
    ax = max(qx, 0.0)
    ay = max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - radius


def segment_distance(px: float, py: float, x0: float, y0: float, x1: float, y1: float) -> float:
    dx = x1 - x0
    dy = y1 - y0
    length_sq = dx * dx + dy * dy
    if length_sq <= 0.0001:
        return math.hypot(px - x0, py - y0)
    t = ((px - x0) * dx + (py - y0) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def background() -> None:
    cx = W * 0.24
    cy = W * 0.16
    cx2 = W * 0.82
    cy2 = W * 0.9
    for y in range(W):
        row = y * W
        for x in range(W):
            index = row + x
            vertical = y / (W - 1)
            base_r = OBSIDIAN[0] + (PANEL[0] - OBSIDIAN[0]) * vertical
            base_g = OBSIDIAN[1] + (PANEL[1] - OBSIDIAN[1]) * vertical
            base_b = OBSIDIAN[2] + (PANEL[2] - OBSIDIAN[2]) * vertical

            d1 = math.hypot(x - cx, y - cy) / (W * 0.62)
            glow1 = max(0.0, 1.0 - d1) ** 2 * 0.30
            d2 = math.hypot(x - cx2, y - cy2) / (W * 0.58)
            glow2 = max(0.0, 1.0 - d2) ** 2 * 0.22

            r = base_r * (1.0 - glow1) + YES[0] * glow1
            g = base_g * (1.0 - glow1) + YES[1] * glow1
            b = base_b * (1.0 - glow1) + YES[2] * glow1
            r = r * (1.0 - glow2) + NO[0] * glow2
            g = g * (1.0 - glow2) + NO[1] * glow2
            b = b * (1.0 - glow2) + NO[2] * glow2
            red[index] = r
            green[index] = g
            blue[index] = b


def badge() -> None:
    center = W / 2
    half = W * 0.455
    radius = W * 0.19
    border = 1.6 * SCALE

    def shader(px: float, py: float):
        distance = sdf_rounded_rect(px, py, center, center, half, radius)
        if distance <= -border:
            return PANEL, 0.35
        if abs(distance) <= border:
            return YES, 0.55 * clamp01(1.0 - abs(distance) / border)
        return PANEL, 0.0

    paint(0, 0, W, W, shader)


def grid() -> None:
    inset = W * 0.19
    step = (W - inset * 2) / 6
    width = 0.7 * SCALE
    for i in range(7):
        x = inset + step * i
        y = inset + step * i

        def vertical(px: float, py: float, x=x):
            distance = abs(px - x)
            inside = 1.0 if inset - 1 <= py <= W - inset + 1 else 0.0
            return LINE, 0.55 * inside * clamp01(width + 0.5 - distance)

        def horizontal(px: float, py: float, y=y):
            distance = abs(py - y)
            inside = 1.0 if inset - 1 <= px <= W - inset + 1 else 0.0
            return LINE, 0.55 * inside * clamp01(width + 0.5 - distance)

        paint(int(x - 3), int(inset), int(x + 3), int(W - inset), vertical)
        paint(int(inset), int(y - 3), int(W - inset), int(y + 3), horizontal)


def ring() -> None:
    cx = W * 0.5
    cy = W * 0.5
    radius = W * 0.335
    width = 1.4 * SCALE

    def shader(px: float, py: float):
        distance = abs(math.hypot(px - cx, py - cy) - radius)
        return NO, 0.30 * clamp01(width + 0.5 - distance)

    paint(int(cx - radius - 6), int(cy - radius - 6), int(cx + radius + 6), int(cy + radius + 6), shader)

    tick_width = 1.1 * SCALE
    for angle in (200.0, 235.0, 270.0, 305.0, 340.0):
        radians = math.radians(angle)
        x0 = cx + (radius - 14 * SCALE) * math.cos(radians)
        y0 = cy + (radius - 14 * SCALE) * math.sin(radians)
        x1 = cx + (radius + 2 * SCALE) * math.cos(radians)
        y1 = cy + (radius + 2 * SCALE) * math.sin(radians)

        def tick(px: float, py: float, x0=x0, y0=y0, x1=x1, y1=y1):
            distance = segment_distance(px, py, x0, y0, x1, y1)
            return NO, 0.45 * clamp01(tick_width + 0.5 - distance)

        paint(int(min(x0, x1) - 4), int(min(y0, y1) - 4), int(max(x0, x1) + 4), int(max(y0, y1) + 4), tick)


def polyline(points: list[tuple[float, float]]) -> None:
    for index in range(len(points) - 1):
        x0, y0 = points[index]
        x1, y1 = points[index + 1]
        if index == len(points) - 2:
            color = YES
            glow_alpha = 0.18
            core_alpha = 0.95
        else:
            color = YES
            glow_alpha = 0.10
            core_alpha = 0.7

        def glow(px: float, py: float, x0=x0, y0=y0, x1=x1, y1=y1, color=color, alpha=glow_alpha):
            distance = segment_distance(px, py, x0, y0, x1, y1)
            return color, alpha * clamp01(11.0 * SCALE + 0.5 - distance)

        def core(px: float, py: float, x0=x0, y0=y0, x1=x1, y1=y1, color=color, alpha=core_alpha):
            distance = segment_distance(px, py, x0, y0, x1, y1)
            return color, alpha * clamp01(2.6 * SCALE + 0.5 - distance)

        pad = int(13 * SCALE)
        paint(int(min(x0, x1) - pad), int(min(y0, y1) - pad), int(max(x0, x1) + pad), int(max(y0, y1) + pad), glow)
        paint(int(min(x0, x1) - pad), int(min(y0, y1) - pad), int(max(x0, x1) + pad), int(max(y0, y1) + pad), core)


def node(cx: float, cy: float, radius: float, color: tuple[float, float, float], core: tuple[float, float, float]) -> None:
    outer = radius * SCALE
    inner = radius * 0.45 * SCALE

    def glow(px: float, py: float):
        distance = math.hypot(px - cx, py - cy)
        return color, 0.22 * clamp01(outer * 1.9 - distance)

    def disc(px: float, py: float):
        distance = math.hypot(px - cx, py - cy)
        return color, clamp01(outer - distance)

    def centre(px: float, py: float):
        distance = math.hypot(px - cx, py - cy)
        return core, clamp01(inner - distance)

    pad = int(outer * 2 + 4)
    paint(int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad), glow)
    paint(int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad), disc)
    paint(int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad), centre)


def diamond(cx: float, cy: float, radius: float, color: tuple[float, float, float]) -> None:
    outer = radius * SCALE

    def shader(px: float, py: float):
        distance = abs(px - cx) + abs(py - cy)
        return color, clamp01(outer * 0.7 - distance)

    def glow(px: float, py: float):
        distance = abs(px - cx) + abs(py - cy)
        return color, 0.2 * clamp01(outer * 1.8 - distance)

    pad = int(outer * 2)
    paint(int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad), glow)
    paint(int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad), shader)


def downscale() -> bytes:
    output = bytearray(SIZE * SIZE * 3)
    inv = 1.0 / (SCALE * SCALE)
    for y in range(SIZE):
        for x in range(SIZE):
            total_r = 0.0
            total_g = 0.0
            total_b = 0.0
            for sy in range(SCALE):
                base = (y * SCALE + sy) * W + x * SCALE
                for sx in range(SCALE):
                    index = base + sx
                    total_r += red[index]
                    total_g += green[index]
                    total_b += blue[index]
            offset = (y * SIZE + x) * 3
            output[offset] = int(max(0.0, min(255.0, total_r * inv)))
            output[offset + 1] = int(max(0.0, min(255.0, total_g * inv)))
            output[offset + 2] = int(max(0.0, min(255.0, total_b * inv)))
    return bytes(output)


def write_png(path: Path, pixels: bytes) -> None:
    raw = bytearray()
    stride = SIZE * 3
    for y in range(SIZE):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def main() -> None:
    s = SCALE
    background()
    grid()
    badge()
    ring()
    points = [
        (0.255 * W, 0.745 * W),
        (0.375 * W, 0.615 * W),
        (0.475 * W, 0.665 * W),
        (0.615 * W, 0.475 * W),
        (0.735 * W, 0.345 * W),
    ]
    polyline(points)
    for px, py in points[:-1]:
        node(px, py, 7.0, YES, INK)
    node(points[-1][0], points[-1][1], 9.5, AMBER, (255.0, 245.0, 205.0))
    diamond(points[-1][0], points[-1][1], 20.0, AMBER)

    pixels = downscale()
    outputs = [
        ROOT / "frontend" / "public" / "logo.png",
        ROOT / "docs" / "logo.png",
    ]
    for path in outputs:
        write_png(path, pixels)
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")
    print(f"supersample factor {s}x, size {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
