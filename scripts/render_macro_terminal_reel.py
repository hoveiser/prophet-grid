#!/usr/bin/env python3
"""Render the ProphetGrid flagship terminal reel: bespoke audio, capture, subtitles.

Pipeline, in order:

1. synthesise a 50 second stereo ambient track for a trading floor bed, using
   only the Python standard library so the audio is reproducible from source;
2. write the subtitle script for the reel;
3. serve the built frontend with vite preview and drive it with Playwright,
   injecting a funded testnet desk key into browser storage only;
4. compress the capture to the target duration, burn the subtitles, mux the
   synthesised audio, and write the result to both video locations.

Usage:
    .venv/bin/python scripts/render_macro_terminal_reel.py
    .venv/bin/python scripts/render_macro_terminal_reel.py --skip-capture
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import struct
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
ARTIFACTS = ROOT / ".build"
AUDIO = ARTIFACTS / "terminal-bed.wav"
SUBTITLES = ARTIFACTS / "terminal-reel.srt"
RAW_VIDEO = ARTIFACTS / "terminal-session.webm"
DOCS_VIDEO = ROOT / "docs" / "demo-video-subtitled.mp4"
SITE_VIDEO = FRONTEND / "public" / "demo-video-subtitled.mp4"

SAMPLE_RATE = 44100
SECONDS = 50.0
CHANNELS = 2
TARGET_SECONDS = (48.0, 52.0)
MAX_BYTES = 15 * 1024 * 1024
PORT = 4176

CHORDS = [
    (0.0, 12.0, (55.00, 110.00, 164.81, 220.00, 329.63)),
    (12.0, 12.0, (49.00, 98.00, 146.83, 196.00, 293.66)),
    (24.0, 12.0, (61.74, 123.47, 185.21, 246.94, 369.99)),
    (36.0, 14.0, (58.27, 116.54, 174.81, 233.08, 349.23)),
]
MOTIF = [440.00, 523.25, 659.25, 587.33, 523.25, 440.00, 349.23, 392.00]
TEMPO = 96.0
BEAT = 60.0 / TEMPO


def clamp(value: float) -> float:
    return -1.0 if value < -1.0 else (1.0 if value > 1.0 else value)


def envelope(local: float, length: float, attack: float, release: float) -> float:
    if local <= 0 or local >= length:
        return 0.0
    if local < attack:
        return local / attack
    tail = length - local
    if tail < release:
        return max(0.0, tail / release)
    return 1.0


def shape(index: int) -> int:
    """Deterministic pseudo random integer, so the bed is byte reproducible."""
    value = (index * 1103515245 + 12345) & 0x7FFFFFFF
    return (value >> 7) & 0xFFFF


def synthesise(path: Path) -> None:
    total = int(SAMPLE_RATE * SECONDS)
    left = [0.0] * total
    right = [0.0] * total

    for start, length, voices in CHORDS:
        for voice, frequency in enumerate(voices):
            amplitude = 0.085 / (1.0 + voice * 0.42)
            offset = voice * 0.13
            first = int(start * SAMPLE_RATE)
            last = min(total, int((start + length) * SAMPLE_RATE))
            for index in range(first, last):
                position = (index - first) / SAMPLE_RATE
                shape_value = math.sin(2.0 * math.pi * frequency * (position + offset))
                shape_value += 0.22 * math.sin(2.0 * math.pi * frequency * 2.0 * position + voice)
                swell = envelope(position, length, 2.2, 3.0)
                side = 1.0 + 0.05 * math.sin(2.0 * math.pi * 0.07 * position + voice)
                left[index] += clamp(shape_value) * amplitude * swell * side
                right[index] += clamp(shape_value) * amplitude * swell * (2.0 - side)

    tick = 0.0
    while tick < SECONDS:
        first = int(tick * SAMPLE_RATE)
        length = int(0.045 * SAMPLE_RATE)
        accent = 0.20 if int(tick / BEAT) % 4 == 0 else 0.10
        for offset in range(length):
            index = first + offset
            if index >= total:
                break
            position = offset / SAMPLE_RATE
            decay = math.exp(-position * 90.0)
            value = math.sin(2.0 * math.pi * 1180.0 * position) * decay
            left[index] += value * accent * 0.55
            right[index] += value * accent * 0.45
        tick += BEAT / 2.0

    step = 0
    note_at = 4.0
    while note_at < SECONDS - 2.0:
        frequency = MOTIF[step % len(MOTIF)]
        first = int(note_at * SAMPLE_RATE)
        length = int(0.62 * SAMPLE_RATE)
        for offset in range(length):
            index = first + offset
            if index >= total:
                break
            position = offset / SAMPLE_RATE
            tone = math.sin(2.0 * math.pi * frequency * position)
            tone += 0.35 * math.sin(2.0 * math.pi * frequency * 3.0 * position)
            decay = math.exp(-position * 5.2) * envelope(position, 0.62, 0.01, 0.32)
            pan = 0.62 if step % 2 == 0 else 0.38
            left[index] += tone * decay * 0.10 * pan
            right[index] += tone * decay * 0.10 * (1.0 - pan)
        step += 1
        note_at += BEAT if step % 4 else BEAT * 1.5

    riser_start = 28.0
    for index in range(int(riser_start * SAMPLE_RATE), min(total, int(44.0 * SAMPLE_RATE))):
        position = (index - riser_start * SAMPLE_RATE) / SAMPLE_RATE
        progress = position / 16.0
        frequency = 90.0 + 520.0 * progress
        value = math.sin(2.0 * math.pi * frequency * position * 0.05)
        weight = 0.020 * progress
        jitter = ((shape(index) % 64) - 32) / 3200.0
        left[index] += (value + jitter) * weight
        right[index] += (value - jitter) * weight

    for index in range(int(43.5 * SAMPLE_RATE), min(total, int(49.0 * SAMPLE_RATE))):
        position = (index - 43.5 * SAMPLE_RATE) / SAMPLE_RATE
        value = 0.0
        for frequency in (261.63, 329.63, 392.0, 523.25):
            value += math.sin(2.0 * math.pi * frequency * position)
        swell = envelope(position, 5.5, 0.05, 3.2) * 0.075
        left[index] += value * swell
        right[index] += value * swell * 0.9

    peak = max(0.0001, max(abs(item) for item in left + right))
    scale = 0.82 / peak
    frames = bytearray()
    for index in range(total):
        sample_l = int(clamp(left[index] * scale) * 32767)
        sample_r = int(clamp(right[index] * scale) * 32767)
        frames += struct.pack("<hh", sample_l, sample_r)

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(CHANNELS)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(bytes(frames))
    print(f"audio bed written: {path} {SECONDS:.1f}s stereo", flush=True)


def write_subtitles(path: Path) -> None:
    cues = [
        (0.3, 4.6, "ProphetGrid flagship v1: conditional macro books,\nadjudicated by validator consensus."),
        (4.9, 9.6, "Every strike sits on a 250 basis point grid.\nThe print is read from two independent sources."),
        (9.9, 14.6, "The orderbook shows depth on both legs,\nthe derived budget split and the gate clock."),
        (14.9, 19.6, "The payoff modeler replays the same rule\nthe chain runs: quantized print, band, payout."),
        (19.9, 25.0, "A hedge basket pairs opposite legs across two books\nand reserves the maximum liability up front."),
        (25.3, 31.0, "Dual source telemetry shows the fields validators\nmust agree on, and the challenge record."),
        (31.3, 37.0, "Three burner desks, an injected wallet, or watch only:\nthe desk session signs every action."),
        (37.3, 42.5, "Refused deposits are parked as refund claims,\nnever reverted and never stranded."),
        (42.8, 46.5, "The custody rail checks supply against the native value\nthe address actually holds on the node."),
        (46.8, 50.0, "No admin key, no manual clock.\nProphetGrid on GenLayer studionet."),
    ]
    blocks = []
    for number, (start, end, text) in enumerate(cues, start=1):
        blocks.append(f"{number}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(blocks), encoding="utf-8")
    print(f"subtitles written: {path} ({len(cues)} cues)", flush=True)


def srt_time(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    rest = seconds - hours * 3600 - minutes * 60
    whole = int(rest)
    millis = int(round((rest - whole) * 1000))
    return f"{hours:02d}:{minutes:02d}:{whole:02d},{millis:03d}"


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    print("run: " + " ".join(command[:6]), flush=True)
    result = subprocess.run(command, cwd=str(cwd), env=env, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "")[-1200:]
        for token in list((env or {}).get("CAPTURE_DESK_KEY", "").split()) + [
            os.environ.get("GENLAYER_PRIVATE_KEY", "")
        ]:
            if token:
                detail = detail.replace(token, "***")
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(command[:4])}\n{detail}")
    tail = (result.stdout or "").strip().splitlines()[-3:]
    if tail:
        print("  " + "\n  ".join(tail)[:600], flush=True)


def start_preview() -> subprocess.Popen:
    process = subprocess.Popen(
        ["npx", "vite", "preview", "--port", str(PORT), "--host", "127.0.0.1", "--strictPort"],
        cwd=str(FRONTEND),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    import time

    import requests

    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            if requests.get(f"http://127.0.0.1:{PORT}/prophet-grid/", timeout=5).status_code == 200:
                return process
        except requests.RequestException:
            time.sleep(1.5)
    return process


def capture(base_url: str) -> None:
    from deploy_studionet import derive_burner_key

    key = os.environ.get("GENLAYER_PRIVATE_KEY", "")
    if not key:
        raise SystemExit("GENLAYER_PRIVATE_KEY is missing from .env, the reel needs a funded desk")
    if not key.startswith("0x"):
        key = "0x" + key
    desk_key = derive_burner_key(key, 1)
    env = os.environ.copy()
    env["CAPTURE_DESK_KEY"] = desk_key
    from eth_account import Account

    env["CAPTURE_DESK_ADDRESS"] = Account.from_key(desk_key).address
    run(
        ["node", "scripts/capture_terminal_session.mjs", base_url, str(RAW_VIDEO)],
        cwd=FRONTEND,
        env=env,
    )


def probe_seconds(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def mux(skip_capture: bool) -> None:
    import time

    if skip_capture and not RAW_VIDEO.exists():
        raise SystemExit(f"no capture at {RAW_VIDEO}, run without --skip-capture")
    raw_seconds = probe_seconds(RAW_VIDEO)
    factor = (SECONDS / raw_seconds) if raw_seconds > 1 else 1.0
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(RAW_VIDEO), "-i", str(AUDIO),
        "-vf", (
            f"setpts=PTS*{factor:.6f},"
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2,"
            f"subtitles={SUBTITLES}:charenc=utf-8:fontsdir=/usr/share/fonts,"
            "format=yuv420p"
        ),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-t", f"{SECONDS:.1f}", "-shortest", "-movflags", "+faststart",
        str(DOCS_VIDEO),
    ]
    run(command, cwd=ROOT)
    shutil.copy2(DOCS_VIDEO, SITE_VIDEO)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
         "-show_entries", "stream=codec_name,codec_type", "-of", "json", str(DOCS_VIDEO)],
        capture_output=True, text=True, check=True,
    )
    payload = __import__("json").loads(probe.stdout)
    duration = float(payload.get("format", {}).get("duration", 0))
    size = int(payload.get("format", {}).get("size", 0))
    codecs = [item.get("codec_type") for item in payload.get("streams", [])]
    print(textwrap.dedent(f"""
        reel report
          path      {DOCS_VIDEO}
          site copy {SITE_VIDEO}
          duration  {duration:.2f}s (target {TARGET_SECONDS[0]:.0f} to {TARGET_SECONDS[1]:.0f}s)
          size      {size / 1024 / 1024:.2f} MB (limit {MAX_BYTES / 1024 / 1024:.0f} MB)
          streams   {codecs}
        """), flush=True)
    if not (TARGET_SECONDS[0] <= duration <= TARGET_SECONDS[1]):
        raise SystemExit("duration outside the target window")
    if size > MAX_BYTES:
        raise SystemExit("reel is larger than the size limit")
    if "audio" not in codecs:
        raise SystemExit("reel has no audio stream")
    time.sleep(0.2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the flagship terminal reel")
    parser.add_argument("--skip-capture", action="store_true", help="reuse the existing raw capture")
    parser.add_argument("--audio-only", action="store_true")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    synthesise(AUDIO)
    write_subtitles(SUBTITLES)
    if args.audio_only:
        return 0

    preview = None
    try:
        if not args.skip_capture:
            preview = start_preview()
            capture(f"http://127.0.0.1:{PORT}/prophet-grid/", )
        mux(args.skip_capture)
    finally:
        if preview is not None:
            preview.terminate()
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "scripts"))
    sys.exit(main())
