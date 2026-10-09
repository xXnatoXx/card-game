// Every sound in the game is synthesized here with Web Audio: no sound files. Effects go through
// a crude bit-crusher so they sound like an old machine, to match the dithered picture.

type Kind = 'white' | 'brown';

function makeNoise(ctx: AudioContext, seconds: number, kind: Kind): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/** Rounds every sample to one of `steps` levels each side of zero: digital grit. */
function crushCurve(steps: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
  muted: boolean;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private volumes: Volumes = { master: 0.8, sfx: 0.9, ambience: 0.5, muted: false };
  private lastBeatPhase = 1;

  constructor() {
    // Browsers only allow audio after the player does something.
    const unlock = () => this.start();
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = { ...volumes };
    this.applyVolumes();
  }

  // --- Setup ------------------------------------------------------------------

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master.connect(compressor).connect(ctx.destination);

    this.sfx = ctx.createGain();
    const crusher = ctx.createWaveShaper();
    crusher.curve = crushCurve(24);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;
    this.sfx.connect(crusher).connect(tone).connect(this.master);

    this.amb = ctx.createGain();
    this.amb.connect(this.master);

    this.noise = makeNoise(ctx, 1, 'white');
    this.brown = makeNoise(ctx, 4, 'brown');
    this.applyVolumes();
    this.startAmbience();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfx || !this.amb) return;
    const t = ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(v.ambience, t, 0.05);
  }

  /** The room: mains hum, the lamp's electric buzz with a little flutter, and dark room tone. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const amb = this.amb!;
    [50, 100, 150].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = [0.05, 0.022, 0.01][i]!;
      o.connect(g).connect(amb);
      o.start();
    });

    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 100;
    const buzzBand = ctx.createBiquadFilter();
    buzzBand.type = 'bandpass';
    buzzBand.frequency.value = 2400;
    buzzBand.Q.value = 4;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.006;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 7;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.004;
    flutter.connect(flutterDepth).connect(buzzGain.gain);
    buzz.connect(buzzBand).connect(buzzGain).connect(amb);
    buzz.start();
    flutter.start();

    const room = ctx.createBufferSource();
    room.buffer = this.brown;
    room.loop = true;
    const roomLow = ctx.createBiquadFilter();
    roomLow.type = 'lowpass';
    roomLow.frequency.value = 500;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.18;
    room.connect(roomLow).connect(roomGain).connect(amb);
    room.start();
  }

  // --- Building blocks ----------------------------------------------------------

  private get ready(): AudioContext | null {
    return this.ctx && this.sfx && this.noise ? this.ctx : null;
  }

  private envelope(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.sfx!);
    return g;
  }

  private noiseBurst(t: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private tone(type: OscillatorType, from: number, to: number, t: number, duration: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + duration);
    o.start(t);
    o.stop(t + duration + 0.05);
    return o;
  }

  // --- Cards ------------------------------------------------------------------

  /** A card sliding across felt, then landing. */
  cardSlide(delay = 0): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const band = this.filter('bandpass', 3200, 0.9);
    band.frequency.setValueAtTime(3200, t);
    band.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    this.noiseBurst(t, 0.2).connect(band).connect(this.envelope(t, 0.45, 0.01, 0.16));
    this.tone('sine', 180, 90, t + 0.15, 0.06).connect(this.envelope(t + 0.15, 0.25, 0.003, 0.06));
  }

  /** A card flipped face up. */
  cardFlip(delay = 0): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    this.noiseBurst(t, 0.05).connect(this.filter('highpass', 2500)).connect(this.envelope(t, 0.4, 0.002, 0.04));
    this.tone('sine', 900, 380, t, 0.04).connect(this.envelope(t, 0.12, 0.002, 0.04));
  }

  /** A soft tap, for picking a card in your hand. */
  cardTap(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.03).connect(this.filter('bandpass', 2000, 1.2)).connect(this.envelope(t, 0.2, 0.002, 0.025));
  }

  /** Cards swept across the table. */
  sweep(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const band = this.filter('bandpass', 2500, 0.7);
    band.frequency.setValueAtTime(2500, t);
    band.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    this.noiseBurst(t, 0.55).connect(band).connect(this.envelope(t, 0.35, 0.05, 0.45));
  }

  /** A riffle shuffle, at the start of a game. */
  shuffle(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const start = ctx.currentTime;
    for (let i = 0; i < 16; i++) {
      const t = start + i * 0.034 + rand(0, 0.012);
      this.noiseBurst(t, 0.03).connect(this.filter('bandpass', 3000, 1.5)).connect(this.envelope(t, rand(0.15, 0.28), 0.002, 0.025));
    }
    this.cardSlide(0.62);
  }

  /** Two knocks on the table: "pass". */
  pass(): void {
    const ctx = this.ready;
    if (!ctx) return;
    for (const offset of [0, 0.13]) {
      const t = ctx.currentTime + offset;
      this.tone('sine', 120, 70, t, 0.07).connect(this.envelope(t, 0.5, 0.003, 0.07));
      this.noiseBurst(t, 0.02).connect(this.filter('lowpass', 1500)).connect(this.envelope(t, 0.2, 0.002, 0.02));
    }
  }

  // --- Interface ----------------------------------------------------------------

  click(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone('square', 1400, 1400, t, 0.012).connect(this.envelope(t, 0.1, 0.001, 0.012));
  }

  /** One typewriter key, for the speech above players' heads. */
  tick(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.012).connect(this.filter('highpass', 3000)).connect(this.envelope(t, 0.12, 0.001, 0.008));
    const f = rand(1800, 2600);
    this.tone('square', f, f, t, 0.006).connect(this.envelope(t, 0.035, 0.001, 0.006));
  }

  /** Leaning in over the table. */
  whoosh(volume = 1): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const low = this.filter('lowpass', 300);
    low.frequency.setValueAtTime(300, t);
    low.frequency.exponentialRampToValueAtTime(1100, t + 0.2);
    low.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    this.noiseBurst(t, 0.5).connect(low).connect(this.envelope(t, 0.3 * volume, 0.12, 0.35));
  }

  // --- Calls and consequences -----------------------------------------------------

  /** Static and a sputter of tones: the glitch when a bluff is called. */
  zap(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const start = ctx.currentTime;
    for (let i = 0; i < 8; i++) {
      const t = start + i * 0.03;
      const f = rand(200, 1600);
      this.tone('square', f, f, t, 0.025).connect(this.envelope(t, 0.08, 0.002, 0.02));
    }
    this.noiseBurst(start, 0.25).connect(this.filter('bandpass', 1200, 0.6)).connect(this.envelope(start, 0.2, 0.005, 0.22));
  }

  /** The lamp spitting electricity while it flickers. */
  crackle(ms: number): void {
    const ctx = this.ready;
    if (!ctx) return;
    const pops = Math.round(ms / 45);
    for (let i = 0; i < pops; i++) {
      const t = ctx.currentTime + Math.random() * (ms / 1000);
      this.noiseBurst(t, 0.015).connect(this.filter('highpass', 1500)).connect(this.envelope(t, rand(0.08, 0.3), 0.001, rand(0.005, 0.015)));
    }
  }

  /** A bluff caught: an old siren winds up and down. */
  alarm(ms: number): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const duration = ms / 1000;
    const end = t + duration;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.2, t + 0.06);
    out.gain.setValueAtTime(0.2, Math.max(t + 0.07, end - 0.35));
    out.gain.linearRampToValueAtTime(0.0001, end);
    out.connect(this.sfx!);
    const lowpass = this.filter('lowpass', 2400);
    lowpass.connect(out);

    const sweep = ctx.createOscillator();
    sweep.type = 'triangle';
    sweep.frequency.value = 1.4;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    sweep.connect(depth);
    for (const [type, freq] of [['sawtooth', 820], ['square', 826]] as const) {
      const o = this.tone(type, freq, freq, t, duration);
      depth.connect(o.frequency);
      o.connect(lowpass);
    }
    sweep.start(t);
    sweep.stop(end + 0.05);
  }

  /** A false alarm: a flat "wrong" buzzer, twice. */
  falseAlarm(): void {
    const ctx = this.ready;
    if (!ctx) return;
    for (const offset of [0, 0.3]) {
      const t = ctx.currentTime + offset;
      const lowpass = this.filter('lowpass', 1400);
      lowpass.connect(this.envelope(t, 0.22, 0.01, 0.22));
      this.tone('square', 150, 150, t, 0.22).connect(lowpass);
      this.tone('square', 157, 157, t, 0.22).connect(lowpass);
    }
  }

  /** The screen breaking: a thud, a crash, and glass tinkling down. */
  glassBreak(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone('sine', 90, 40, t, 0.25).connect(this.envelope(t, 0.6, 0.003, 0.25));
    this.noiseBurst(t, 0.6).connect(this.filter('highpass', 1800)).connect(this.envelope(t, 0.55, 0.002, 0.5));
    for (let i = 0; i < 16; i++) {
      const at = t + Math.random() * 0.8;
      const f = rand(2500, 7000);
      this.tone('sine', f, f * rand(0.9, 1.05), at, 0.12).connect(this.envelope(at, rand(0.05, 0.16), 0.001, rand(0.04, 0.12)));
    }
  }

  /** One heartbeat, lub-dub. */
  heartbeat(strength = 1): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const low = this.filter('lowpass', 220);
    low.connect(this.envelope(t, 0.7 * strength, 0.005, 0.14));
    this.tone('sine', 62, 40, t, 0.14).connect(low);
    const low2 = this.filter('lowpass', 220);
    low2.connect(this.envelope(t + 0.2, 0.45 * strength, 0.005, 0.13));
    this.tone('sine', 56, 38, t + 0.2, 0.13).connect(low2);
  }

  /** The light seems to drop: a low swell, for the end of a round. */
  darkness(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone('sine', 80, 55, t, 0.9).connect(this.envelope(t, 0.25, 0.2, 0.7));
  }

  /** You won: a warm chord swelling out of the dark. */
  win(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [196, 247, 294, 392]) this.tone('triangle', f, f, t, 2).connect(this.envelope(t, 0.1, 0.4, 1.6));
  }

  /** You lost: a falling drone. */
  lose(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const low = this.filter('lowpass', 600);
    low.connect(this.envelope(t, 0.22, 0.05, 1.6));
    this.tone('sawtooth', 110, 52, t, 1.7).connect(low);
  }

  /**
   * Called every frame with the red-edge danger level (0..1) and the frame time; plays a heartbeat
   * whenever the visual beat starts, so the thumps land with the red pulses.
   */
  setDanger(level: number, timeMs: number): void {
    const phase = (timeMs / 1000) % 0.85;
    if (level > 0 && phase < this.lastBeatPhase) this.heartbeat(0.35 + 0.65 * level);
    this.lastBeatPhase = phase;
  }
}

export const sound = new SoundEngine();
