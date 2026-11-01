/** Terminal audio engine: synthesised cues, no sample files. */

type Shape = OscillatorType;

interface Cue {
  steps: Array<{ at: number; hz: number; ms: number; shape: Shape; gain: number }>;
}

const CUES: Record<string, Cue> = {
  tape: { steps: [{ at: 0, hz: 1180, ms: 40, shape: "square", gain: 0.2 }] },
  depth: {
    steps: [
      { at: 0, hz: 420, ms: 60, shape: "triangle", gain: 0.22 },
      { at: 55, hz: 620, ms: 60, shape: "triangle", gain: 0.18 },
    ],
  },
  fill: {
    steps: [
      { at: 0, hz: 523.25, ms: 70, shape: "sine", gain: 0.26 },
      { at: 60, hz: 783.99, ms: 110, shape: "sine", gain: 0.2 },
    ],
  },
  reject: {
    steps: [
      { at: 0, hz: 190, ms: 90, shape: "sawtooth", gain: 0.24 },
      { at: 80, hz: 140, ms: 130, shape: "sawtooth", gain: 0.2 },
    ],
  },
  print: {
    steps: [
      { at: 0, hz: 294, ms: 70, shape: "sine", gain: 0.2 },
      { at: 62, hz: 440, ms: 70, shape: "sine", gain: 0.2 },
      { at: 124, hz: 587, ms: 150, shape: "sine", gain: 0.24 },
    ],
  },
  settle: {
    steps: [
      { at: 0, hz: 261.63, ms: 120, shape: "sine", gain: 0.24 },
      { at: 90, hz: 392, ms: 120, shape: "sine", gain: 0.22 },
      { at: 180, hz: 523.25, ms: 240, shape: "sine", gain: 0.26 },
    ],
  },
  sweep: { steps: [{ at: 0, hz: 880, ms: 120, shape: "sine", gain: 0.14 }] },
};

class TerminalAudio {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private silenced = false;

  setSilent(value: boolean): void {
    this.silenced = value;
    if (this.bus && this.context) {
      this.bus.gain.setTargetAtTime(value ? 0 : 0.14, this.context.currentTime, 0.02);
    }
  }

  isSilent(): boolean {
    return this.silenced;
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
      this.bus = this.context.createGain();
      this.bus.gain.value = this.silenced ? 0 : 0.14;
      this.bus.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  play(cue: keyof typeof CUES): void {
    if (this.silenced) return;
    const context = this.ensure();
    if (!context || !this.bus) return;
    const spec = CUES[cue];
    if (!spec) return;
    for (const step of spec.steps) {
      const start = context.currentTime + step.at / 1000;
      const stop = start + step.ms / 1000;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = step.shape;
      oscillator.frequency.setValueAtTime(step.hz, start);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(step.gain, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, stop);
      oscillator.connect(envelope);
      envelope.connect(this.bus);
      oscillator.start(start);
      oscillator.stop(stop + 0.02);
    }
  }
}

export const audio = new TerminalAudio();
