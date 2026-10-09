import type { RevealMessage } from '@bluff/protocol';

/** Things the HUD shows briefly: log lines, big banners, reveals, errors, and the end of a game. */
export type FeedItem =
  | { kind: 'log'; text: string }
  | { kind: 'banner'; text: string }
  | { kind: 'reveal'; msg: RevealMessage }
  | { kind: 'toast'; text: string }
  | { kind: 'over'; winner: number };

type Listener = (item: FeedItem) => void;

export class Feed {
  private readonly listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(item: FeedItem): void {
    for (const fn of this.listeners) fn(item);
  }
}
