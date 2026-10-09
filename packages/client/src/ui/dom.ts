import { RANKS, type Card, type Rank } from '@bluff/rules';
import { SUIT_SYMBOL, isRed } from '../scene/cards.js';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Creates an element. Strings become text nodes, so names typed by other players are never
 * parsed as HTML. `on*` props become event listeners; `class` sets the class name.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Drops null/false children, for `replaceChildren(...present(a, maybe && b))`. */
export function present(...children: Child[]): (Node | string)[] {
  return children.filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (typeof c === 'number' ? String(c) : c));
}

export interface Screen {
  el: HTMLElement;
  update(): void;
  destroy(): void;
}

const RANK_WORDS: Record<Rank, string> = {
  A: 'ace', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
  '8': 'eight', '9': 'nine', '10': 'ten', J: 'jack', Q: 'queen', K: 'king',
};

/** "1 ace", "4 aces", "2 sixes". */
export function claim(count: number, rank: Rank): string {
  const word = RANK_WORDS[rank];
  return `${count} ${count === 1 ? word : word.endsWith('x') ? `${word}es` : `${word}s`}`;
}

export function sortHand(cards: readonly Card[]): Card[] {
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  return [...cards].sort(
    (a, b) =>
      RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) ||
      suits.indexOf(a.suit) - suits.indexOf(b.suit) ||
      (a.deck ?? 0) - (b.deck ?? 0),
  );
}

/** A small face-up card for the HUD. Cards from a second deck (x2 mode) are printed inverted. */
export function cardFace(card: Card, props: Props = {}): HTMLDivElement {
  const extra = props.class ? ` ${String(props.class)}` : '';
  const inverted = card.deck ? ' inverted' : '';
  return h(
    'div',
    { ...props, class: `card ${isRed(card) ? 'red' : 'black'}${inverted}${extra}` },
    h('span', { class: 'rank' }, card.rank),
    h('span', { class: 'suit' }, SUIT_SYMBOL[card.suit]),
    h('span', { class: 'pip' }, SUIT_SYMBOL[card.suit]),
  );
}

export function animalName(animal: string): string {
  return animal === 'polar' ? 'Polar bear' : animal[0]!.toUpperCase() + animal.slice(1);
}
