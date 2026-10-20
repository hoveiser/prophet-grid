type Wave = OscillatorType;

class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.16, this.context.currentTime, 0.02);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.16;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }

  private tone(frequency: number, duration: number, wave: Wave, delay = 0, gain = 0.5): void {
    const context = this.ensure();
    if (!context || !this.master) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  }

  click(): void {
    this.tone(760, 0.055, "triangle", 0, 0.28);
    this.tone(1180, 0.04, "sine", 0.02, 0.16);
  }

  hover(): void {
    this.tone(520, 0.028, "sine", 0, 0.1);
  }

  success(): void {
    this.tone(523.25, 0.16, "triangle", 0, 0.4);
    this.tone(659.25, 0.16, "triangle", 0.09, 0.36);
    this.tone(783.99, 0.26, "sine", 0.18, 0.34);
    this.tone(1046.5, 0.3, "sine", 0.26, 0.18);
  }

  error(): void {
    this.tone(180, 0.18, "sawtooth", 0, 0.26);
    this.tone(132, 0.26, "square", 0.06, 0.16);
  }

  whoosh(): void {
    const context = this.ensure();
    if (!context || !this.master) return;
    const length = Math.floor(context.sampleRate * 0.28);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const falloff = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * falloff * falloff;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(680, context.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2400, context.currentTime + 0.24);
    filter.Q.value = 1.4;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.34, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start();
  }

  settle(): void {
    this.whoosh();
    this.tone(392, 0.22, "sine", 0.05, 0.24);
    this.tone(587.33, 0.3, "triangle", 0.16, 0.22);
  }
}

export const sound = new SoundEngine();
