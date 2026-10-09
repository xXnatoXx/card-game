import { Quaternion, Vector3, type Object3D } from 'three';

export type Ease = (t: number) => number;
export const linear: Ease = (t) => t;
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Tween {
  start: number;
  duration: number;
  update: (k: number) => void;
  ease: Ease;
  resolve: () => void;
}

const active = new Set<Tween>();
/** Animation time. Runs at `speed` times real time, so a backlog can be played through quickly. */
let clock = 0;
let lastReal = performance.now();
let speed = 1;

/** Plays every running and future tween faster (e.g. 10 to catch up on a backlog), or back at 1. */
export function setTweenSpeed(value: number): void {
  speed = value;
}

/** Animates k from 0 to 1 over `ms`, after `delay`. Resolves when done. */
export function tween(ms: number, update: (k: number) => void, ease: Ease = easeInOut, delay = 0): Promise<void> {
  return new Promise((resolve) => {
    active.add({ start: clock + delay, duration: Math.max(1, ms), update, ease, resolve });
  });
}

/** Called once per frame by the stage. */
export function stepTweens(time: number): void {
  // Cap each step, so coming back to a hidden tab doesn't skip everything in one frame.
  clock += Math.min(100, Math.max(0, time - lastReal)) * speed;
  lastReal = time;
  for (const t of active) {
    if (clock < t.start) continue;
    const k = Math.min(1, (clock - t.start) / t.duration);
    t.update(t.ease(k));
    if (k >= 1) {
      active.delete(t);
      t.resolve();
    }
  }
}

export function wait(ms: number): Promise<void> {
  return tween(ms, () => {}, linear);
}

export interface MoveOptions {
  to: Vector3;
  quaternion?: Quaternion;
  ms?: number;
  delay?: number;
  /** Height of a hop in the middle of the move. */
  arc?: number;
  ease?: Ease;
}

export function moveTo(obj: Object3D, { to, quaternion, ms = 450, delay = 0, arc = 0, ease = easeInOut }: MoveOptions): Promise<void> {
  let from: Vector3 | null = null;
  let fromQ: Quaternion | null = null;
  return tween(
    ms,
    (k) => {
      from ??= obj.position.clone();
      fromQ ??= obj.quaternion.clone();
      obj.position.lerpVectors(from, to, k);
      obj.position.y += Math.sin(k * Math.PI) * arc;
      if (quaternion) obj.quaternion.slerpQuaternions(fromQ, quaternion, k);
    },
    ease,
    delay,
  );
}
