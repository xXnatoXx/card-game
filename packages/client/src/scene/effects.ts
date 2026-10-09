import { CanvasTexture, NearestFilter, NoColorSpace, Vector3, type IUniform } from 'three';

type Uniforms = Record<string, IUniform>;

const CRACK_W = 480;
const CRACK_H = 270;

/**
 * Screen effects for the big moments: glitches, a breaking screen, the red alarm, the room going
 * dark, and a racing heartbeat. Each one decays by itself; the stage calls update() every frame.
 */
export class Effects {
  /** Camera jitter for screen shake, added to the camera position each frame. */
  readonly shake = new Vector3();
  /** 0..1: how strongly the red alarm light is sweeping the table. */
  alarmLevel = 0;

  private glitchLevel = 0;
  private crackLevel = 0;
  private crackHold = 0;
  private alarmUntil = 0;
  private darkLevel = 0;
  private pulseLevel = 0;
  private flashLevel = 0;
  private shakeAmp = 0;
  private danger = 0;
  private now = 0;
  /** 1 normally; lower with "reduced screen effects" (less shake, flashing, glitching). */
  intensity = 1;
  private readonly baseExposure: number;
  private readonly crackCanvas = document.createElement('canvas');
  private readonly crackTexture: CanvasTexture;

  constructor(private readonly uniforms: Uniforms) {
    this.baseExposure = uniforms.exposure!.value as number;
    this.crackCanvas.width = CRACK_W;
    this.crackCanvas.height = CRACK_H;
    const ctx = this.crackCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(0,128,128)';
    ctx.fillRect(0, 0, CRACK_W, CRACK_H);
    this.crackTexture = new CanvasTexture(this.crackCanvas);
    this.crackTexture.minFilter = this.crackTexture.magFilter = NearestFilter;
    this.crackTexture.generateMipmaps = false;
    this.crackTexture.colorSpace = NoColorSpace;
    uniforms.tCrack!.value = this.crackTexture;
  }

  /** Rows of pixels tear sideways and the colours split, fading out in about half a second. */
  glitch(strength = 1): void {
    this.glitchLevel = Math.max(this.glitchLevel, strength);
  }

  shakeScreen(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** The screen cracks from a random point of impact, holds, then fades. */
  breakScreen(): void {
    drawCrack(this.crackCanvas);
    this.crackTexture.needsUpdate = true;
    this.crackLevel = 1;
    this.crackHold = 2.4;
    this.glitch(1);
    this.shakeScreen(0.16);
  }

  /** The red alarm sweeps the room for `ms`. */
  alarm(ms: number): void {
    this.alarmUntil = this.now + ms;
  }

  /** The lamp seems to dim for a moment. */
  darken(): void {
    this.darkLevel = 1;
  }

  /** One heavy heartbeat: the vignette closes in and lets go. */
  heartbeat(): void {
    this.pulseLevel = 1;
  }

  flash(amount = 1): void {
    this.flashLevel = Math.max(this.flashLevel, amount);
  }

  /** 0..1: red pulsing at the edges of the screen, for a turn timer running out. */
  setDanger(level: number): void {
    this.danger = Math.max(0, Math.min(1, level));
  }

  update(dt: number, time: number): void {
    this.now = time;
    const t = time / 1000;
    this.glitchLevel = Math.max(0, this.glitchLevel - dt * 2.5);
    if (this.crackHold > 0) this.crackHold -= dt;
    else this.crackLevel = Math.max(0, this.crackLevel - dt / 1.4);
    // A siren: pulses while on, then dies away.
    this.alarmLevel = time < this.alarmUntil ? 0.45 + 0.55 * Math.abs(Math.sin(t * 5)) : Math.max(0, this.alarmLevel - dt * 2);
    this.darkLevel = Math.max(0, this.darkLevel - dt * 0.9);
    this.pulseLevel = Math.max(0, this.pulseLevel - dt * 1.6);
    this.flashLevel = Math.max(0, this.flashLevel - dt * 4);
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 0.4);
    const k = this.intensity;
    const amp = this.shakeAmp * k;
    this.shake.set((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * amp, 0);

    // A racing double heartbeat: thump-thump, pause.
    const beatT = t % 0.85;
    const beat = Math.exp(-beatT * 14) + (beatT > 0.2 ? 0.7 * Math.exp(-(beatT - 0.2) * 14) : 0);

    const u = this.uniforms;
    u.time!.value = t % 1000;
    u.glitch!.value = this.glitchLevel * k;
    u.crack!.value = this.crackLevel;
    u.tintAmount!.value = this.alarmLevel * 0.75 * (0.3 + 0.7 * k);
    u.vignette!.value = 0.6 + this.pulseLevel * 0.35 + this.danger * 0.15;
    u.danger!.value = this.danger * (0.3 + 0.7 * Math.min(1, beat)) * (0.5 + 0.5 * k);
    u.exposure!.value = this.baseExposure * (1 - 0.6 * this.darkLevel);
    u.flash!.value = this.flashLevel * 0.35 * k;
  }
}

type Point = [number, number];

/**
 * Draws a spider-web crack. Red channel: the crack lines. Green/blue: how far each shard of glass
 * shifts the picture (128 = not at all), stronger near the point of impact.
 */
function drawCrack(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgb(0,128,128)';
  ctx.fillRect(0, 0, w, h);

  const cx = w * (0.3 + Math.random() * 0.4);
  const cy = h * (0.3 + Math.random() * 0.4);
  const spokes = 9 + Math.floor(Math.random() * 5);
  const start = Math.random() * Math.PI * 2;
  const angles = Array.from({ length: spokes }, (_, i) => start + ((i + (Math.random() - 0.5) * 0.6) / spokes) * Math.PI * 2);
  const last = 6;
  const radii = [0, 10, 28, 60, 110, 190, 700].map((r, i) => (i === 0 || i === last ? r : r * (0.8 + Math.random() * 0.4)));
  // Each spoke wobbles a little at every ring, so the cracks look jagged.
  const pts: Point[][] = angles.map((a) =>
    radii.map((r, i): Point => {
      const wobble = i === 0 ? 0 : (Math.random() - 0.5) * 0.18;
      return [cx + Math.cos(a + wobble) * r, cy + Math.sin(a + wobble) * r];
    }),
  );
  const at = (j: number, i: number): Point => pts[j]![i]!;

  for (let j = 0; j < spokes; j++) {
    const k = (j + 1) % spokes;
    for (let i = 0; i < last; i++) {
      const strength = 70 * (1 - i / last);
      ctx.fillStyle = `rgb(0,${Math.round(128 + (Math.random() - 0.5) * strength)},${Math.round(128 + (Math.random() - 0.5) * strength)})`;
      ctx.beginPath();
      ctx.moveTo(...at(j, i));
      ctx.lineTo(...at(j, i + 1));
      ctx.lineTo(...at(k, i + 1));
      ctx.lineTo(...at(k, i));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Lines go in the red channel, added on top so the shard offsets underneath survive.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgb(255,0,0)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const spoke of pts) {
    ctx.moveTo(...spoke[0]!);
    for (const p of spoke.slice(1)) ctx.lineTo(...p);
  }
  for (let i = 1; i < last; i++) {
    for (let j = 0; j < spokes; j++) {
      if (Math.random() < 0.35) continue;
      ctx.moveTo(...at(j, i));
      ctx.lineTo(...at((j + 1) % spokes, i));
    }
  }
  ctx.stroke();
  ctx.fillStyle = 'rgb(255,0,0)';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);
  ctx.globalCompositeOperation = 'source-over';
}
