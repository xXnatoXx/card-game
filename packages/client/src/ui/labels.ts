import { sound } from '../audio/sound.js';
import { t } from '../i18n.js';
import { store } from '../net.js';
import type { Stage } from '../scene/stage.js';
import type { TableScene } from '../scene/table-scene.js';
import { h } from './dom.js';
import { UI_HEIGHT, UI_WIDTH } from './frame.js';

export interface LabelItem {
  name: string;
  sub: string;
  turn: boolean;
  away: boolean;
}

/** How a line is said: a claim (amber), a call (red), or something quiet (dim italics). */
export type Tone = 'claim' | 'call' | 'quiet';

/** Milliseconds per typed character, and how long a finished line stays up. */
const CHAR_MS = 45;
const HOLD_MS = 2600;
const FADE_MS = 500;

interface Line {
  text: string;
  start: number;
  shown: number;
}

interface Tag {
  el: HTMLElement;
  info: HTMLElement;
  bubble: HTMLElement;
  timer: HTMLElement | null;
  line: Line | null;
}

/**
 * Name tags floating over each animal's head, kept in place every frame. Above each name, what
 * that player just did is typed out letter by letter, like a typewriter, then fades.
 */
export class Labels {
  private tags: Tag[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly scene: TableScene,
    stage: Stage,
  ) {
    stage.onFrame(() => this.place());
  }

  /** One item per seat; null for your own seat. */
  render(items: (LabelItem | null)[]): void {
    while (this.tags.length < items.length) {
      const bubble = h('div', { class: 'speech gone' });
      const info = h('div', {});
      const el = h('div', { class: 'label' }, bubble, info);
      this.root.append(el);
      this.tags.push({ el, info, bubble, timer: null, line: null });
    }
    for (const tag of this.tags.splice(items.length)) tag.el.remove();

    items.forEach((item, i) => {
      const tag = this.tags[i]!;
      tag.el.hidden = !item;
      if (!item) return;
      tag.el.className = `label${item.turn ? ' turn' : ''}${item.away ? ' away' : ''}`;
      tag.timer = item.turn ? h('span', { class: 'label-timer' }) : null;
      tag.info.replaceChildren(
        h('div', { class: 'label-name' }, item.name),
        h('div', { class: 'label-sub' }, item.away ? t().awayTag(item.sub) : item.sub, tag.timer),
      );
    });
  }

  /** Types `text` out above a seat's head. A new line replaces whatever they were saying. */
  say(seat: number, text: string, tone: Tone): void {
    const tag = this.tags[seat];
    if (!tag || tag.el.hidden) return;
    tag.line = { text, start: performance.now(), shown: -1 };
    tag.bubble.className = `speech ${tone}`;
  }

  private place(): void {
    const deadline = store.turnDeadline;
    const now = performance.now();
    for (const [i, tag] of this.tags.entries()) {
      if (tag.el.hidden) continue;
      const p = this.scene.project(i);
      const px = p.x * UI_WIDTH;
      const py = p.y * UI_HEIGHT;
      const x = Math.min(UI_WIDTH - 70, Math.max(70, px));
      const y = Math.min(UI_HEIGHT * 0.55, Math.max(80, py));
      // Hidden while you lean in to inspect, so nothing floats over the close-up.
      tag.el.style.visibility = p.visible && !this.scene.inspecting ? 'visible' : 'hidden';
      tag.el.classList.toggle('edge', x !== px);
      tag.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      if (tag.timer) {
        const text = deadline ? ` · ${t().seconds(Math.ceil(Math.max(0, deadline - Date.now()) / 1000))}` : '';
        if (tag.timer.textContent !== text) tag.timer.textContent = text;
      }
      this.type(tag, now);
    }
  }

  /** Advances the typewriter: one more letter every CHAR_MS, then hold, fade, and clear. */
  private type(tag: Tag, now: number): void {
    const line = tag.line;
    if (!line) return;
    const elapsed = now - line.start;
    const shown = Math.min(line.text.length, Math.floor(elapsed / CHAR_MS));
    if (shown !== line.shown) {
      // A typewriter key for each new letter.
      if (shown > line.shown && line.text[shown - 1]?.trim()) sound.tick();
      line.shown = shown;
      tag.bubble.replaceChildren(line.text.slice(0, shown), h('span', { class: 'caret' }));
    }
    const done = line.text.length * CHAR_MS + HOLD_MS;
    if (elapsed > done) tag.bubble.classList.add('fading');
    if (elapsed > done + FADE_MS) {
      tag.line = null;
      tag.bubble.classList.add('gone');
    }
  }
}
