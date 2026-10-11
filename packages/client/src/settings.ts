// Player preferences, kept in this browser. Screens and systems subscribe and apply them.

export interface Settings {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
  /** CRT scanlines and flicker over the whole screen. */
  crt: boolean;
  /** Less shake, flashing, glitching and lamp strobing. */
  reducedEffects: boolean;
  /** The camera follows the mouse a little. */
  mouseLook: boolean;
}

const KEY = 'falsealarm.settings';
const DEFAULTS: Settings = {
  master: 0.8,
  sfx: 0.9,
  ambience: 0.5,
  music: 0.5,
  muted: false,
  crt: true,
  reducedEffects: false,
  mouseLook: true,
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

/** Calls `fn` now and after every change. */
export function onSettings(fn: Listener): void {
  listeners.add(fn);
  fn(settings);
}

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked: settings just won't survive a reload */
  }
  for (const fn of listeners) fn(settings);
}
