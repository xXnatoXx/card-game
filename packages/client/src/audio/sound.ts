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

/** MIDI note number to frequency. */
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

interface Bar {
  bass: number;
  pad: readonly number[];
  /** Notes the melody may land on over this chord. */
  melody: readonly number[];
  /** The table tune's piano figure: low, middle and high notes, the high note's neighbour, and the note hammered on top. */
  riff?: readonly [number, number, number, number, number];
}

export type TuneName = 'lobby' | 'table';

interface Tune {
  /** Seconds per beat; four beats to a bar. */
  beat: number;
  /** How likely the melody is to play on each half beat of a bar. */
  melody: readonly number[];
  /** The chords, as MIDI notes. */
  bars: readonly Bar[];
}

const TUNES: Record<TuneName, Tune> = {
  // Between games: eight slow bars in D minor that never quite settle.
  lobby: {
    beat: 0.9,
    melody: [0.55, 0.1, 0.3, 0.25, 0.45, 0.15, 0.35, 0.2],
    bars: [
      { bass: 38, pad: [53, 57, 60, 64], melody: [62, 65, 69, 72, 74, 76] }, // Dm9
      { bass: 46, pad: [53, 57, 58, 62], melody: [62, 65, 69, 70, 74] }, // Bbmaj7
      { bass: 43, pad: [53, 55, 58, 62], melody: [62, 65, 67, 70, 74] }, // Gm7
      { bass: 45, pad: [52, 55, 58, 61], melody: [61, 64, 67, 70, 73] }, // A7b9
      { bass: 38, pad: [53, 57, 60, 64], melody: [62, 65, 69, 72, 74, 76] }, // Dm9
      { bass: 46, pad: [53, 57, 58, 62], melody: [62, 65, 69, 70, 74] }, // Bbmaj7
      { bass: 40, pad: [52, 55, 58, 62], melody: [62, 64, 67, 70, 74] }, // Em7b5
      { bass: 45, pad: [52, 55, 57, 61], melody: [61, 64, 67, 69, 73] }, // A7
    ],
  },
  // While a game is on, a battle of nerves: a restless piano figure in E minor over a bass that
  // sinks a semitone every bar, then two bars that wind the tension back up.
  table: {
    beat: 0.48,
    melody: [0.35, 0, 0.1, 0, 0.25, 0, 0.15, 0.1],
    bars: [
      { bass: 40, pad: [52, 55, 59], melody: [76, 78, 79, 83], riff: [64, 67, 71, 72, 76] }, // Em
      { bass: 39, pad: [51, 54, 59], melody: [75, 78, 83], riff: [63, 66, 71, 72, 75] }, // B/D#
      { bass: 38, pad: [50, 55, 59], melody: [74, 79, 83], riff: [62, 67, 71, 72, 74] }, // G/D
      { bass: 37, pad: [49, 52, 57], melody: [73, 76, 81], riff: [61, 64, 69, 70, 73] }, // A/C#
      { bass: 36, pad: [48, 52, 55], melody: [72, 76, 79, 84], riff: [60, 64, 67, 68, 72] }, // C
      { bass: 35, pad: [47, 52, 55], melody: [71, 76, 79, 83], riff: [59, 64, 67, 69, 71] }, // Em/B
      { bass: 41, pad: [48, 53, 57], melody: [72, 77, 81], riff: [60, 65, 69, 70, 72] }, // F
      { bass: 35, pad: [51, 54, 57], melody: [75, 78, 81, 83], riff: [59, 63, 66, 69, 71] }, // B7
    ],
  },
};
/** The table tune's bass line: semitones above the chord's bass note on each half beat. */
const BASS_LINE = [0, 0, 12, 0, 0, 12, 0, 12];

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private music: GainNode | null = null;
  /** Each tune has its own output, so one can fade out under the other. */
  private tunes: Record<TuneName, { out: GainNode; lead: GainNode; choir: GainNode }> | null = null;
  private tune: TuneName = 'lobby';
  private wow: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private volumes: Volumes = { master: 0.8, sfx: 0.9, ambience: 0.5, music: 0.5, muted: false };
  private lastBeatPhase = 1;
  private bar = 0;
  private nextBar = 0;
  private lastPitch = 69;

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

    this.music = ctx.createGain();
    this.music.connect(this.master);

    this.noise = makeNoise(ctx, 1, 'white');
    this.brown = makeNoise(ctx, 4, 'brown');
    this.applyVolumes();
    this.startAmbience();
    this.startMusic();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfx || !this.amb || !this.music) return;
    const t = ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(v.ambience, t, 0.05);
    this.music.gain.setTargetAtTime(v.music, t, 0.05);
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

  // --- Music --------------------------------------------------------------------

  /**
   * The music playing somewhere in the room, as if off a worn tape: muffled, a little unsteady in
   * pitch, with an echo on the melody. Slow and uneasy between games, urgent while one is on.
   */
  private startMusic(): void {
    const ctx = this.ctx!;
    const warm = this.filter('lowpass', 2600, 0.5);
    warm.connect(this.music!);

    const flutter = ctx.createOscillator();
    flutter.frequency.value = 0.4;
    this.wow = ctx.createGain();
    this.wow.gain.value = 5; // cents
    flutter.connect(this.wow);
    flutter.start();

    const outputs = (name: TuneName) => {
      const out = ctx.createGain();
      out.gain.value = name === this.tune ? 1 : 0;
      out.connect(warm);
      const echo = ctx.createDelay(2);
      echo.delayTime.value = TUNES[name].beat * 0.75;
      const send = ctx.createGain();
      send.gain.value = 0.4;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.35;
      send.connect(echo).connect(feedback).connect(echo);
      echo.connect(out);
      const lead = ctx.createGain();
      lead.connect(out);
      lead.connect(send);
      // Two narrow bands turn a buzzing chord into something like voices singing "ah".
      const choir = ctx.createGain();
      for (const freq of [650, 1080]) choir.connect(this.filter('bandpass', freq, 4)).connect(out);
      return { out, lead, choir };
    };
    this.tunes = { lobby: outputs('lobby'), table: outputs('table') };

    setInterval(() => this.scheduleMusic(), 250);
  }

  /** Switches the music, fading the old tune out under the new one. */
  setTune(tune: TuneName): void {
    if (tune === this.tune) return;
    this.tune = tune;
    this.bar = 0;
    this.nextBar = 0;
    if (!this.ctx || !this.tunes) return;
    for (const name of Object.keys(this.tunes) as TuneName[]) {
      this.tunes[name].out.gain.setTargetAtTime(name === tune ? 1 : 0, this.ctx.currentTime, 0.4);
    }
  }

  /** Queues the next bar a little before it is due. */
  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (this.volumes.muted || this.volumes.music <= 0) {
      this.nextBar = 0;
      return;
    }
    if (this.nextBar < now) this.nextBar = now + 0.1;
    while (this.nextBar < now + 2) {
      this.playBar(this.tune, this.bar, this.nextBar);
      this.bar++;
      this.nextBar += TUNES[this.tune].beat * 4;
    }
  }

  private playBar(name: TuneName, index: number, t: number): void {
    const tune = TUNES[name];
    const bar = tune.bars[index % tune.bars.length]!;
    const { out, lead, choir } = this.tunes![name];
    const half = tune.beat / 2;
    if (name === 'lobby') {
      // Each chord breathes in and out, overlapping the next.
      for (const pitch of bar.pad) {
        this.note('triangle', pitch, t, 0.045, 1.5, 4.2, out, -6);
        this.note('sawtooth', pitch, t, 0.012, 1.5, 4.2, out, 6);
      }
      // The root on the first beat, and a quieter push towards the next bar.
      this.note('triangle', bar.bass, t, 0.22, 0.03, 2.2, out);
      this.note('triangle', bar.bass, t + tune.beat * 2.5, 0.12, 0.03, 1.2, out);
    } else {
      // The tune runs in rounds of sixteen bars: two bars of piano and ticking alone, then the
      // bass and drums come in, and voices join for the second half.
      const round = index % (tune.bars.length * 2);
      for (const pitch of bar.pad) {
        this.note('triangle', pitch, t, 0.035, 0.25, 2.2, out, -6);
        this.note('sawtooth', pitch, t, 0.02, 0.25, 2.2, out, 6);
        if (round >= tune.bars.length) this.note('sawtooth', pitch + 12, t, 0.05, 0.5, 2.4, choir);
      }
      // The piano never lets up: sixteen quick notes a bar, every other one hammering the same key.
      const [low, mid, high, neighbour, top] = bar.riff!;
      const turn = [low, mid, high, mid, low, mid, neighbour, mid];
      for (let i = 0; i < 16; i++) {
        const at = t + (i * half) / 2;
        const pitch = i % 2 ? top : turn[i / 2]!;
        const peak = i % 2 ? 0.06 : i % 8 === 0 ? 0.14 : 0.1;
        this.note('triangle', pitch, at, peak, 0.004, 0.45, out);
        this.note('sine', pitch + 12, at, peak / 4, 0.003, 0.15, out);
      }
      BASS_LINE.forEach((step, slot) => {
        const at = t + slot * half;
        this.noiseBurst(at, 0.04).connect(this.filter('bandpass', 3200)).connect(this.envelope(at, slot % 2 ? 0.07 : 0.035, 0.002, 0.03, out));
        if (round < 2) return;
        this.note('triangle', bar.bass + step, at, slot === 0 ? 0.2 : 0.13, 0.01, 0.3, out);
        if (slot % 4 === 0) this.tone('sine', 120, 45, at, 0.14).connect(this.envelope(at, 0.3, 0.004, 0.14, out));
        if (slot % 4 === 2) this.noiseBurst(at, 0.14).connect(this.filter('bandpass', 1800, 0.8)).connect(this.envelope(at, 0.08, 0.003, 0.12, out));
      });
    }
    // A few melody notes a bar, each a small step from the last, so it never repeats exactly.
    const ring = name === 'lobby' ? 1.6 : 1.2;
    for (let slot = 0; slot < tune.melody.length; slot++) {
      if (Math.random() > tune.melody[slot]!) continue;
      const near = bar.melody.filter((p) => p !== this.lastPitch && Math.abs(p - this.lastPitch) <= 5);
      const pool = near.length ? near : bar.melody;
      const pitch = pool[Math.floor(Math.random() * pool.length)]!;
      this.lastPitch = pitch;
      const at = t + slot * half + rand(0, 0.02);
      this.note('sine', pitch, at, 0.14, 0.008, ring, lead);
      this.note('sine', pitch + 12, at, 0.045, 0.005, ring / 3, lead);
    }
  }

  /** One note of the tune: `swell` seconds to reach `peak`, then `fade` seconds to die away. */
  private note(type: OscillatorType, pitch: number, t: number, peak: number, swell: number, fade: number, to: AudioNode, cents = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz(pitch);
    o.detune.value = cents;
    this.wow!.connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell);
    g.gain.setTargetAtTime(0, t + swell, fade / 5);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + swell + fade);
  }

  // --- Building blocks ----------------------------------------------------------

  private get ready(): AudioContext | null {
    return this.ctx && this.sfx && this.noise ? this.ctx : null;
  }

  private envelope(t: number, peak: number, attack: number, decay: number, to: AudioNode = this.sfx!): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(to);
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

  /** A bluff caught: the game show "wrong answer" buzzer, one long harsh blast. */
  alarm(): void {
    const ctx = this.ready;
    if (!ctx) return;
    const t = ctx.currentTime;
    const duration = 0.75;
    const end = t + duration;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.24, t + 0.015);
    out.gain.setValueAtTime(0.24, end - 0.04);
    out.gain.linearRampToValueAtTime(0.0001, end);
    out.connect(this.sfx!);
    const lowpass = this.filter('lowpass', 1800);
    lowpass.connect(out);
    for (const [type, freq] of [['sawtooth', 98], ['sawtooth', 104], ['square', 147]] as const) {
      this.tone(type, freq, freq, t, duration).connect(lowpass);
    }
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
