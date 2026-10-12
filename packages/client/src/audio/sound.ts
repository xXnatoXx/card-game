// The game's sound effects are synthesized here with Web Audio. Effects go through a crude
// bit-crusher so they sound like an old machine, to match the dithered picture. The music's band
// plays recorded notes from public/samples, and synthesized ones until those have loaded.

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

/** Squashes loud input flat, the way an overdriven guitar amp does. */
function overdriveCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(3 * x);
  }
  return curve;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** MIDI note number to frequency. */
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

interface Bar {
  /** The bass guitar's notes for this bar: the root, then any others its line picks from. */
  bass: readonly number[];
  /** The rhythm guitar's chord. It chugs on the two lowest strings. */
  chord: readonly number[];
  /** Notes the melody may land on over this chord. */
  melody: readonly number[];
  /** The four notes the lead guitar picks between, lowest first. */
  lead: readonly number[];
}

/** One bar of drums, a character per sixteenth: X a full hit, x a softer one. A C among the hi-hats is a crash cymbal. */
interface Beat {
  kick: string;
  snare: string;
  hat: string;
}

export type TuneName = 'lobby' | 'table';

interface Tune {
  /** Seconds per beat; four beats to a bar. */
  beat: number;
  /** How likely the melody is to play on each half beat of a bar. */
  melody: readonly number[];
  /** Which of the bar's lead notes the lead guitar picks on each half beat. */
  picking: readonly number[];
  /**
   * The bass guitar's line for each bar, going round. On each half beat it plays one of the bar's
   * bass notes, or lets the last one ring on (-).
   */
  bassLines: readonly string[];
  /** The drums for each bar of a round. In a bar without any, the bass drops out too. */
  drums: readonly (Beat | null)[];
  /** The chords, as MIDI notes. */
  bars: readonly Bar[];
}

/** Reads a line of music, a character per step: which note is struck, on which step, and for how many steps it rings. */
function notesOf(line: string): [note: number, step: number, held: number][] {
  const notes: [number, number, number][] = [];
  for (let step = 0; step < line.length; step++) {
    if (line[step] === '-') continue;
    let held = 1;
    while (line[step + held] === '-') held++;
    notes.push([+line[step]!, step, held]);
  }
  return notes;
}

const HITS: Record<string, number> = { X: 1, x: 0.65 };
/** The same bar of drums with a crash cymbal on its first beat, for where the band comes in. */
const crashing = (beat: Beat): Beat => ({ ...beat, hat: 'C' + beat.hat.slice(1) });

// The lobby's drums: a plain backbeat under ticking hi-hats, in some bars with a second kick after the third beat.
const BACKBEAT: Beat = { kick: 'X.......X.......', snare: '....X.......X...', hat: 'x.X.x.X.x.X.x.X.' };
const DOUBLED: Beat = { ...BACKBEAT, kick: 'X.......X.x.....' };

// The table's drums. In half time the snare waits for the third beat, and the kick sometimes pushes
// ahead of it; in full time the snare is on every second beat, and fills close the phrases.
const HALF: Beat = { kick: 'X...............', snare: '........X.......', hat: 'X...X...X...X...' };
const HALF_PUSHED: Beat = { ...HALF, kick: 'X.....x.........', hat: 'X...X...X...X.x.' };
const HALF_BUSY: Beat = { ...HALF_PUSHED, kick: 'X..x..x.........' };
const FULL: Beat = { kick: 'X.......X..x....', snare: '....X.......X...', hat: 'X...X...X...X...' };
const FULL_BUSY: Beat = { ...FULL, kick: 'X..x....X..x....', snare: '....X.......X..x' };
const FILL: Beat = { ...FULL, snare: '....X.......X.xx' };
const BIG_FILL: Beat = { ...FULL_BUSY, snare: '....X.......xxxx' };

// Both tunes are played by the same band: a heavy groove of drums, bass and overdriven guitars.
const TUNES: Record<TuneName, Tune> = {
  // Between games: eight slow bars in D minor that never quite settle. The lead climbs each chord
  // and comes back down. The bass drives on each chord's root, and in the first two bars of every
  // four flicks to a neighbouring note on the last half beat. Half way through a round the drums
  // and bass drop out for a bar.
  lobby: {
    beat: 0.8,
    melody: [0.55, 0.1, 0.3, 0.25, 0.45, 0.15, 0.35, 0.2],
    picking: [0, 1, 2, 3, 2, 1, 2, 3],
    bassLines: ['00000001', '00000001', '00000000', '00000000'],
    drums: [
      BACKBEAT, DOUBLED, crashing(BACKBEAT), DOUBLED, BACKBEAT, BACKBEAT, DOUBLED, null,
      crashing(BACKBEAT), DOUBLED, BACKBEAT, DOUBLED, BACKBEAT, BACKBEAT, DOUBLED, BACKBEAT,
    ],
    bars: [
      { bass: [38, 41], chord: [38, 45, 50], melody: [62, 65, 69, 72, 74, 76], lead: [53, 57, 60, 64] }, // Dm9
      { bass: [46, 45], chord: [41, 46, 53], melody: [62, 65, 69, 70, 74], lead: [53, 57, 58, 62] }, // Bbmaj7
      { bass: [43], chord: [38, 43, 50], melody: [62, 65, 67, 70, 74], lead: [53, 55, 58, 62] }, // Gm7
      { bass: [45], chord: [40, 45, 52], melody: [61, 64, 67, 70, 73], lead: [52, 55, 58, 61] }, // A7b9
      { bass: [38, 41], chord: [38, 45, 50], melody: [62, 65, 69, 72, 74, 76], lead: [53, 57, 60, 64] }, // Dm9
      { bass: [46, 45], chord: [41, 46, 53], melody: [62, 65, 69, 70, 74], lead: [53, 57, 58, 62] }, // Bbmaj7
      { bass: [40], chord: [40, 46, 52], melody: [62, 64, 67, 70, 74], lead: [52, 55, 58, 62] }, // Em7b5
      { bass: [45], chord: [40, 45, 52], melody: [61, 64, 67, 69, 73], lead: [52, 55, 57, 61] }, // A7
    ],
  },
  // While a game is on, a battle of nerves in E minor, unhurried, over a bass that sinks a semitone
  // every bar, then two bars that wind the tension back up. Every other note of the lead is on the
  // same string, and every second bar it reaches a step higher. The bass holds long roots, and
  // every second bar ends on a turn: up to a note of the chord twice, then home. For the second
  // half of a round it drives in half beats, popping up an octave, and keeps the turn. The drums
  // play half time for the first half of a round and full time for the second.
  table: {
    beat: 0.66,
    melody: [0.35, 0, 0.1, 0, 0.25, 0, 0.15, 0.1],
    picking: [0, 3, 1, 3, 2, 3, 1, 3],
    bassLines: [
      '0---0220', '001-----', '0---0220', '001-----', '0-1-0220', '0-0-1---', '0---0220', '001-----',
      '00100220', '00100101', '00100220', '00100101', '00100220', '00100101', '00100220', '00100101',
    ],
    drums: [
      HALF, HALF_PUSHED, crashing(HALF), HALF_PUSHED, HALF, HALF_BUSY, HALF, HALF_PUSHED,
      crashing(FULL), FULL_BUSY, FULL, FILL, FULL, FULL_BUSY, FULL, BIG_FILL,
    ],
    bars: [
      { bass: [40, 52, 43], chord: [40, 47, 52], melody: [76, 78, 79, 83], lead: [64, 67, 71, 76] }, // Em
      { bass: [39, 51], chord: [39, 47, 51], melody: [75, 78, 83], lead: [63, 66, 72, 75] }, // B/D#
      { bass: [38, 50, 43], chord: [38, 43, 50], melody: [74, 79, 83], lead: [62, 67, 71, 74] }, // G/D
      { bass: [37, 49], chord: [37, 45, 49], melody: [73, 76, 81], lead: [61, 64, 70, 73] }, // A/C#
      { bass: [36, 48, 40], chord: [36, 43, 48], melody: [72, 76, 79, 84], lead: [60, 64, 67, 72] }, // C
      { bass: [35, 47], chord: [35, 40, 47], melody: [71, 76, 79, 83], lead: [59, 64, 69, 71] }, // Em/B
      { bass: [41, 53, 45], chord: [41, 48, 53], melody: [72, 77, 81], lead: [60, 65, 69, 72] }, // F
      { bass: [35, 47], chord: [35, 42, 47], melody: [75, 78, 81, 83], lead: [59, 63, 69, 71] }, // B7
    ],
  },
};
/** The half beats where the rhythm guitar lets its chord ring; on the rest it chugs with the strings muted. */
const ACCENTS = [0, 3, 6];

/** The recorded instruments under public/samples, and the lowest and highest MIDI note kept of each. */
const RECORDED: Record<string, readonly [number, number]> = {
  distortion_guitar: [35, 84],
  electric_guitar_muted: [35, 48],
  electric_bass_pick: [35, 53],
};
const RECORDED_DRUMS = ['snare', 'hat', 'crash'];

/** A recorded note or drum hit, ready to play. */
interface Sample {
  buffer: AudioBuffer;
  /** Seconds of hush to skip before the sound starts. */
  lead: number;
  /** What to multiply it by so every recording peaks at the same level. */
  gain: number;
}

/** One guitarist: where their recorded notes go, and the amp used for strings synthesized in their place. */
interface Guitar {
  direct: AudioNode;
  amp: AudioNode;
}

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
  private tunes: Record<TuneName, { fade: GainNode; out: AudioNode; guitars: { rhythm: Guitar; lead: Guitar; solo: Guitar } }> | null = null;
  private tune: TuneName = 'lobby';
  private samples = new Map<string, Sample>();
  private strings = new Map<number, { buffer: AudioBuffer; rate: number; loopStart: number }>();
  private wow: GainNode | null = null;
  private vibrato: GainNode | null = null;
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
   * The music: a band of drums, bass and overdriven guitars, a little unsteady in pitch like a
   * worn tape, with an echo on the guitar that sings. Slow and uneasy between games, urgent while
   * one is on.
   */
  private startMusic(): void {
    const ctx = this.ctx!;
    const lfo = (freq: number, cents: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const depth = ctx.createGain();
      depth.gain.value = cents;
      o.connect(depth);
      o.start();
      return depth;
    };
    this.wow = lfo(0.4, 5);
    this.vibrato = lfo(5.5, 14);

    // A guitar amp: overdrive, then the narrow band of a speaker cabinet.
    const overdrive = overdriveCurve();
    const amp = (drive: number, level: number, ...to: AudioNode[]) => {
      const input = ctx.createGain();
      input.gain.value = drive;
      const fuzz = ctx.createWaveShaper();
      fuzz.curve = overdrive;
      fuzz.oversample = '2x';
      const output = ctx.createGain();
      output.gain.value = level;
      input.connect(fuzz).connect(this.filter('highpass', 110)).connect(this.filter('lowpass', 4200, 0.7)).connect(this.filter('lowpass', 4200, 0.7)).connect(output);
      for (const node of to) output.connect(node);
      return input;
    };

    const outputs = (name: TuneName) => {
      const fade = ctx.createGain();
      fade.gain.value = name === this.tune ? 1 : 0;
      fade.connect(this.music!);
      // The drums and bass are muffled, as if heard through a wall.
      const out = this.filter('lowpass', 2600, 0.5);
      out.connect(fade);
      const echo = ctx.createDelay(2);
      echo.delayTime.value = TUNES[name].beat * 0.75;
      const send = ctx.createGain();
      send.gain.value = 0.4;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.35;
      send.connect(echo).connect(feedback).connect(echo);
      echo.connect(out);
      // One amp per guitar, so their notes don't smear into one another. Recorded guitars already
      // carry their amp's sound and go straight out at `level`.
      const guitar = (level: number, drive: number, ampLevel: number, ...to: AudioNode[]): Guitar => {
        const direct = ctx.createGain();
        direct.gain.value = level;
        for (const node of to) direct.connect(node);
        return { direct, amp: amp(drive, ampLevel, ...to) };
      };
      const guitars = {
        rhythm: guitar(0.09, 5, 0.08, fade),
        lead: guitar(0.06, 8, 0.045, fade),
        solo: guitar(0.08, 8, 0.06, fade, send),
      };
      return { fade, out, guitars };
    };
    this.tunes = { lobby: outputs('lobby'), table: outputs('table') };

    this.loadSamples();
    setInterval(() => this.scheduleMusic(), 250);
  }

  /** Fetches the recordings in the background. Until one arrives, its part is synthesized instead. */
  private loadSamples(): void {
    const ctx = this.ctx!;
    const load = async (key: string, file: string) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
        if (!response.ok) return;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        const data = buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
        if (!peak) return;
        let first = 0;
        while (Math.abs(data[first]!) < peak * 0.05) first++;
        this.samples.set(key, { buffer, lead: Math.max(0, first / buffer.sampleRate - 0.002), gain: 1 / peak });
      } catch {
        /* missing or unreadable: the synthesized version keeps playing */
      }
    };
    for (const [sound, [low, high]] of Object.entries(RECORDED)) {
      for (let pitch = low; pitch <= high; pitch++) void load(`${sound}/${pitch}`, `${sound}/${pitch}.mp3`);
    }
    for (const drum of RECORDED_DRUMS) void load(`drums/${drum}`, `drums/${drum}.wav`);
  }

  /** Starts a recording at `t` and returns its source, so the caller can bend its pitch or stop it. */
  private play(sample: Sample, t: number, level: number, to: AudioNode): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    const g = ctx.createGain();
    g.gain.value = sample.gain * level;
    src.connect(g).connect(to);
    src.start(t, sample.lead);
    return src;
  }

  /** Switches the music, fading the old tune out under the new one. */
  setTune(tune: TuneName): void {
    if (tune === this.tune) return;
    this.tune = tune;
    this.bar = 0;
    this.nextBar = 0;
    if (!this.ctx || !this.tunes) return;
    for (const name of Object.keys(this.tunes) as TuneName[]) {
      this.tunes[name].fade.gain.setTargetAtTime(name === tune ? 1 : 0, this.ctx.currentTime, 0.4);
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
    const { fade, out, guitars } = this.tunes![name];
    const half = tune.beat / 2;
    const atTable = name === 'table';
    // Both tunes run in rounds of sixteen bars: the lead guitar opens alone over the ticking, and
    // the rest of the band comes in after two bars.
    const round = index % (tune.bars.length * 2);
    const band = round >= 2;
    const beat = tune.drums[round];
    // The lead grinds out eight held notes a bar.
    tune.picking.forEach((string, slot) => this.strum([bar.lead[string]!], t + slot * half, half - 0.07, guitars.lead));
    if (beat) this.drumBar(beat, t, tune.beat / 4, band, fade, out);
    if (band && !beat) {
      // A break: the rhythm guitar lets one chord ring where the drums and bass were.
      this.strum(bar.chord, t, tune.beat * 4 - 0.3, guitars.rhythm);
    } else if (band) {
      // The bass holds each note until its next one.
      for (const [note, slot, held] of notesOf(tune.bassLines[round % tune.bassLines.length]!)) {
        this.bassNote(bar.bass[note]!, t + slot * half, slot === 0 ? 0.2 : 0.13, held * half - 0.03, fade, out);
      }
      for (let slot = 0; slot < 8; slot++) {
        if (ACCENTS.includes(slot)) this.strum(bar.chord, t + slot * half, half - 0.04, guitars.rhythm);
        else this.strum(bar.chord.slice(0, 2), t + slot * half, 0.06, guitars.rhythm, 'muted');
      }
    }
    // A second guitar sings over the top: once the band is in for the lobby, and for the second
    // half of each round at the table.
    if (atTable ? round >= tune.bars.length : band) {
      for (const [pitch, at] of this.wander(tune, bar, t)) this.strum([pitch], at, atTable ? 1.2 : 1.6, guitars.solo, 'sung');
    }
  }

  /** One bar of drums, a sixteenth at a time. Until the band is in, only the hi-hat ticks. */
  private drumBar(beat: Beat, t: number, sixteenth: number, band: boolean, fade: AudioNode, out: AudioNode): void {
    const snare = this.samples.get('drums/snare');
    const hat = this.samples.get('drums/hat');
    const crash = this.samples.get('drums/crash');
    for (let step = 0; step < 16; step++) {
      const at = t + step * sixteenth;
      const tick = HITS[beat.hat[step]!];
      // A cymbal crash marks the band coming in.
      if (beat.hat[step] === 'C' && band && crash) this.play(crash, at, 0.2, fade);
      else if (tick && hat) this.play(hat, at, 0.1 * tick, fade);
      else if (tick) this.noiseBurst(at, 0.04).connect(this.filter('bandpass', 3200)).connect(this.envelope(at, 0.07 * tick, 0.002, 0.03, out));
      if (!band) continue;
      const kick = HITS[beat.kick[step]!];
      if (kick) this.tone('sine', 120, 45, at, 0.14).connect(this.envelope(at, 0.42 * kick, 0.004, 0.14, out));
      const hit = HITS[beat.snare[step]!];
      if (hit && snare) this.play(snare, at, 0.3 * hit, fade);
      else if (hit) this.noiseBurst(at, 0.14).connect(this.filter('bandpass', 1800, 0.8)).connect(this.envelope(at, 0.15 * hit, 0.003, 0.12, out));
    }
  }

  /** A bass guitar note lasting about `ring` seconds: the recording into `to`, or a plain tone into `muffled`. */
  private bassNote(pitch: number, t: number, level: number, ring: number, to: AudioNode, muffled: AudioNode): void {
    const sample = this.samples.get(`electric_bass_pick/${pitch}`);
    if (!sample) return this.note('triangle', pitch, t, level, 0.01, ring, muffled);
    const hand = this.ctx!.createGain();
    hand.gain.setValueAtTime(1, t);
    hand.gain.setTargetAtTime(0, t + ring - 0.12, 0.05);
    hand.connect(to);
    const src = this.play(sample, t, level, hand);
    this.wow!.connect(src.detune);
    src.stop(t + ring + 0.3);
  }

  /** A few melody notes for a bar, each a small step from the last, so the tune never repeats exactly. */
  private wander(tune: Tune, bar: Bar, t: number): [pitch: number, at: number][] {
    const notes: [number, number][] = [];
    for (let slot = 0; slot < tune.melody.length; slot++) {
      if (Math.random() > tune.melody[slot]!) continue;
      const near = bar.melody.filter((p) => p !== this.lastPitch && Math.abs(p - this.lastPitch) <= 5);
      const pool = near.length ? near : bar.melody;
      const pitch = pool[Math.floor(Math.random() * pool.length)]!;
      this.lastPitch = pitch;
      notes.push([pitch, t + (slot * tune.beat) / 2 + rand(0, 0.02)]);
    }
    return notes;
  }

  /**
   * Guitar strings picked together, ringing for `ring` seconds before a hand stops them. 'muted'
   * is the dull chug of strings damped at the bridge; 'sung' adds a player's vibrato. Each string
   * is a recording if it has arrived, and a synthesized string through the guitar's amp if not.
   */
  private strum(pitches: readonly number[], t: number, ring: number, guitar: Guitar, style: 'open' | 'muted' | 'sung' = 'open'): void {
    const ctx = this.ctx!;
    const muted = style === 'muted';
    const hand = (to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, t);
      g.gain.setTargetAtTime(0, t + ring, 0.03);
      g.connect(to);
      return g;
    };
    let recorded: GainNode | undefined;
    let synthesized: GainNode | undefined;
    pitches.forEach((pitch, i) => {
      // The pick crosses the strings one after another.
      const at = t + i * 0.008;
      const sample = this.samples.get(`${muted ? 'electric_guitar_muted' : 'distortion_guitar'}/${pitch}`);
      let src: AudioBufferSourceNode;
      if (sample) {
        // Muted strings were recorded clean, so they still need the amp's overdrive.
        recorded ??= hand(muted ? guitar.amp : guitar.direct);
        src = this.play(sample, at, 1 / Math.sqrt(pitches.length), recorded);
      } else {
        if (!synthesized) {
          const dull = this.filter('lowpass', 1000);
          dull.connect(guitar.amp);
          synthesized = hand(muted ? dull : guitar.amp);
        }
        const string = this.string(pitch);
        src = ctx.createBufferSource();
        src.buffer = string.buffer;
        src.playbackRate.value = string.rate;
        // Past the end of the buffer the string keeps sounding, held by the amp.
        src.loop = true;
        src.loopStart = string.loopStart;
        src.loopEnd = string.buffer.duration;
        src.connect(synthesized);
        src.start(at);
      }
      this.wow!.connect(src.detune);
      if (style === 'sung') this.vibrato!.connect(src.detune);
      src.stop(t + ring + 0.3);
    });
  }

  /**
   * One plucked string, made once per pitch and kept. A burst of noise goes round a delay as long
   * as the note's wavelength, losing a little brightness each pass, as a real string does
   * (Karplus-Strong). The delay is a whole number of samples, so `rate` nudges it into tune.
   */
  private string(pitch: number): { buffer: AudioBuffer; rate: number; loopStart: number } {
    let string = this.strings.get(pitch);
    if (string) return string;
    const ctx = this.ctx!;
    const period = Math.max(2, Math.round(ctx.sampleRate / hz(pitch) + 0.5));
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // The pick: noise with the fizz taken off, centred so the string doesn't sit off to one side.
    let last = 0;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      last += 0.4 * (Math.random() * 2 - 1 - last);
      data[i] = last;
      sum += last;
    }
    for (let i = 0; i < period; i++) data[i] = (data[i]! - sum / period) * 1.5;
    for (let i = period; i < data.length; i++) data[i] = 0.5 * (data[i - period]! + data[i - period + 1]!);
    // Two turns of the string take a whole number of samples, so the last two loop without a click.
    const loopStart = (data.length - (2 * period - 1)) / ctx.sampleRate;
    string = { buffer, rate: (hz(pitch) * (period - 0.5)) / ctx.sampleRate, loopStart };
    this.strings.set(pitch, string);
    return string;
  }

  /** One note of the tune: `swell` seconds to reach `peak`, then `fade` seconds to die away. */
  private note(type: OscillatorType, pitch: number, t: number, peak: number, swell: number, fade: number, to: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz(pitch);
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
