export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  /** Opaque id. Assigned after shuffling, so it says nothing about the card's face. */
  id: string;
  rank: Rank;
  suit: Suit;
  /** Which deck the card came from when several are shuffled together (0 = first). Part of its face. */
  deck?: number;
}

/** Returns a float in [0, 1), like Math.random. Inject a seeded one for tests and replays. */
export type Rng = () => number;

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

/** Builds `decks` standard 52-card decks (no jokers), shuffled. */
export function createShuffledDeck(decks: number, rng: Rng): Card[] {
  const faces: { rank: Rank; suit: Suit; deck: number }[] = [];
  for (let deck = 0; deck < decks; deck++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) faces.push({ rank, suit, deck });
    }
  }
  shuffleInPlace(faces, rng);
  return faces.map((face, i) => ({ id: `c${i}`, ...face }));
}

/** Fisher-Yates shuffle. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Small seeded PRNG (mulberry32) for tests and reproducible games. Not for anything security-sensitive. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
