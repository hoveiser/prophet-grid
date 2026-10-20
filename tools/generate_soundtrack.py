#!/usr/bin/env python3
"""Generate the 48 second ambient electronic demo soundtrack.

Pure standard library synthesis: additive pads, a pentatonic arpeggio, a sub
bass pulse and a soft click. Everything is deterministic, so the wav file is
reproducible from this script alone.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "artifacts" / "soundtrack.wav"

SAMPLE_RATE = 44100
DURATION = 48.0
CHANNELS = 2
TOTAL = int(SAMPLE_RATE * DURATION)

CHORDS = [
    (0.0, 12.0, (110.00, 130.81, 164.81, 246.94)),
    (12.0, 12.0, (87.31, 110.00, 130.81, 164.81)),
    (24.0, 12.0, (130.81, 164.81, 196.00, 246.94)),
    (36.0, 12.0, (98.00, 123.47, 146.83, 196.00)),
]

ARP_NOTES = [440.00, 523.25, 659.25, 783.99, 659.25, 523.25, 440.00, 392.00]
TEMPO = 84.0
BEAT = 60.0 / TEMPO


def envelope(local: float, length: float, attack: float, release: float) -> float:
    if local < 0.0 or local > length:
        return 0.0
    fade_in = min(1.0, local / attack) if attack > 0 else 1.0
    fade_out = min(1.0, max(0.0, (length - local) / release)) if release > 0 else 1.0
    return fade_in * fade_out


def render() -> list[float]:
    samples = [0.0] * (TOTAL * CHANNELS)

    def add(index: int, channel: int, value: float) -> None:
        if 0 <= index < TOTAL:
            samples[index * CHANNELS + channel] += value

    # Pads: warm additive chords with a slow tremolo.
    for start, length, freqs in CHORDS:
        begin = int(start * SAMPLE_RATE)
        count = int(length * SAMPLE_RATE)
        for voice_index, freq in enumerate(freqs):
            detune = 1.0 + (0.0012 if voice_index % 2 == 0 else -0.0012)
            for n in range(count):
                t = n / SAMPLE_RATE
                env = envelope(t, length, 2.4, 3.6)
                if env <= 0.0:
                    continue
                tremolo = 0.82 + 0.18 * math.sin(2.0 * math.pi * 0.11 * t + voice_index)
                base = math.sin(2.0 * math.pi * freq * detune * t)
                harmonic = 0.18 * math.sin(2.0 * math.pi * freq * 2.0 * t + 0.4)
                air = 0.06 * math.sin(2.0 * math.pi * freq * 3.0 * t + 1.1)
                value = (base + harmonic + air) * env * tremolo * 0.11
                pan = 0.5 + 0.18 * math.sin(voice_index * 1.7)
                add(begin + n, 0, value * (1.0 - pan))
                add(begin + n, 1, value * pan)

    # Sub bass: root note, gently pulsing on the bar.
    for start, length, freqs in CHORDS:
        begin = int(start * SAMPLE_RATE)
        count = int(length * SAMPLE_RATE)
        root = freqs[0] / 2.0
        for n in range(count):
            t = n / SAMPLE_RATE
            env = envelope(t, length, 1.8, 3.0)
            if env <= 0.0:
                continue
            pulse = 0.86 + 0.14 * math.sin(2.0 * math.pi * (BEAT * 2.0) * t)
            value = math.sin(2.0 * math.pi * root * t) * env * pulse * 0.10
            add(begin + n, 0, value)
            add(begin + n, 1, value)

    # Arpeggio: eighth notes, plucked envelope, alternating pan.
    step = BEAT / 2.0
    index = 0
    time_cursor = 2.0
    while time_cursor < DURATION - 3.0:
        note = ARP_NOTES[index % len(ARP_NOTES)] * (1.0 if index % 16 < 8 else 0.5)
        begin = int(time_cursor * SAMPLE_RATE)
        count = int(1.4 * SAMPLE_RATE)
        for n in range(count):
            t = n / SAMPLE_RATE
            env = math.exp(-4.2 * t) * min(1.0, t / 0.004)
            if env <= 0.0001:
                continue
            value = math.sin(2.0 * math.pi * note * t) * env * 0.07
            shimmer = 0.35 * math.sin(2.0 * math.pi * note * 2.005 * t) * env * 0.03
            pan = 0.28 if index % 2 == 0 else 0.72
            add(begin + n, 0, (value + shimmer) * (1.0 - pan))
            add(begin + n, 1, (value + shimmer) * pan)
        index += 1
        time_cursor += step

    # Soft click every second beat to mark the clock.
    click_time = 1.0
    while click_time < DURATION - 2.0:
        begin = int(click_time * SAMPLE_RATE)
        for n in range(int(0.09 * SAMPLE_RATE)):
            t = n / SAMPLE_RATE
            env = math.exp(-28.0 * t)
            value = math.sin(2.0 * math.pi * 1760.0 * t) * env * 0.018
            add(begin + n, 0, value)
            add(begin + n, 1, value)
        click_time += BEAT * 2.0

    # Global fade in and fade out.
    for n in range(TOTAL):
        t = n / SAMPLE_RATE
        fade = 1.0
        if t < 1.6:
            fade *= t / 1.6
        if t > DURATION - 4.0:
            fade *= max(0.0, (DURATION - t) / 4.0)
        samples[n * CHANNELS] *= fade
        samples[n * CHANNELS + 1] *= fade

    return samples


def normalise(samples: list[float], peak: float = 0.86) -> list[float]:
    maximum = 0.0
    for value in samples:
        magnitude = abs(value)
        if magnitude > maximum:
            maximum = magnitude
    if maximum <= 0.0:
        return samples
    gain = peak / maximum
    return [value * gain for value in samples]


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = bytearray()
    for value in samples:
        clipped = max(-1.0, min(1.0, value))
        frames.extend(struct.pack("<h", int(clipped * 32767.0)))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(CHANNELS)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(bytes(frames))


def main() -> None:
    samples = normalise(render())
    write_wav(OUTPUT, samples)
    size = OUTPUT.stat().st_size
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({size} bytes, {size / 1024 / 1024:.2f} MB)")
    print(f"{DURATION:.0f}s stereo {SAMPLE_RATE} Hz, peak normalised to 0.86")


if __name__ == "__main__":
    main()
