#!/usr/bin/env python3
"""Assemble the subtitled, audio backed demo video.

Takes the raw Playwright recording and the generated soundtrack, compresses the
recording to exactly 48 seconds, burns the English subtitles and muxes AAC
audio. Prints the final duration and size so the result can be verified.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "artifacts" / "demo-raw.webm"
AUDIO = ROOT / "artifacts" / "soundtrack.wav"
SUBTITLES = ROOT / "docs" / "demo-subtitles.srt"
OUTPUT = ROOT / "docs" / "demo-video-subtitled.mp4"
TARGET_SECONDS = 48.0

STYLE = (
    "FontName=DejaVu Sans,FontSize=14,PrimaryColour=&H00FFFFFF,"
    "BackColour=&HB4070B14,BorderStyle=3,Outline=1,Shadow=0,MarginV=18,Bold=1"
)


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def main() -> int:
    for path in (RAW, AUDIO, SUBTITLES):
        if not path.exists():
            print(f"missing input: {path.relative_to(ROOT)}")
            return 2

    raw_duration = probe_duration(RAW)
    speed = max(1.0, min(3.2, raw_duration / TARGET_SECONDS))
    print(f"raw {raw_duration:.2f}s, speed factor {speed:.3f}x")

    filter_graph = (
        f"[0:v]setpts=PTS/{speed:.6f},fps=30,scale=1280:720:flags=lanczos,"
        f"subtitles={SUBTITLES.relative_to(ROOT)}:force_style='{STYLE}'[v]"
    )
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(RAW),
        "-i",
        str(AUDIO),
        "-filter_complex",
        filter_graph,
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "25",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-t",
        f"{TARGET_SECONDS:.2f}",
        "-movflags",
        "+faststart",
        str(OUTPUT),
    ]
    print("running ffmpeg")
    subprocess.run(command, check=True, cwd=str(ROOT))

    duration = probe_duration(OUTPUT)
    size_mb = OUTPUT.stat().st_size / 1024 / 1024
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {duration:.2f}s, {size_mb:.2f} MB")
    if size_mb > 15:
        print("WARNING: the file is larger than the 15 MB budget")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
