import { describe, expect, it } from 'vitest';
import { createGame, createShuffledDeck, RANKS, seededRng, SUITS } from '../src/index.js';

describe('deck', () => {
  it('has 52 distinct cards, every rank in every suit', () => {
    const deck = createShuffledDeck(1, seededRng(7));
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    expect(new Set(deck.map((c) => `${c.rank}-${c.suit}`)).size).toBe(52);
    for (const rank of RANKS) expect(deck.filter((c) => c.rank === rank)).toHaveLength(SUITS.length);
  });

  it('stacks extra decks with unique ids', () => {
    const deck = createShuffledDeck(2, seededRng(7));
    expect(deck).toHaveLength(104);
    expect(new Set(deck.map((c) => c.id)).size).toBe(104);
  });

  it('marks which deck each card came from, so copies can be told apart', () => {
    const deck = createShuffledDeck(2, seededRng(7));
    expect(deck.filter((c) => c.deck === 0)).toHaveLength(52);
    expect(deck.filter((c) => c.deck === 1)).toHaveLength(52);
    // Every face exists once per deck.
    expect(new Set(deck.map((c) => `${c.rank}-${c.suit}-${c.deck}`)).size).toBe(104);
  });

  it('numbers ids in shuffled order, so ids do not reveal faces', () => {
    const a = createShuffledDeck(1, seededRng(1));
    const b = createShuffledDeck(1, seededRng(2));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.rank + c.suit)).not.toEqual(b.map((c) => c.rank + c.suit));
  });

  it('shuffles the same way for the same seed', () => {
    expect(createShuffledDeck(1, seededRng(42))).toEqual(createShuffledDeck(1, seededRng(42)));
  });
});

describe('createGame', () => {
  it.each([2, 3, 5, 7, 13])('deals all 52 cards as evenly as possible to %i players', (players) => {
    const game = createGame({ players, rng: seededRng(players) });
    const sizes = game.hands.map((h) => h.length);
    expect(sizes.reduce((a, b) => a + b)).toBe(52);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(game.shownHandCounts).toEqual(sizes);
  });

  it('gives the extra cards to the first players dealt, starting with the first player', () => {
    const game = createGame({ players: 5, firstPlayer: 3, rng: seededRng(1) });
    // 52 = 5 * 10 + 2: seats 3 and 4 get the extra card.
    expect(game.hands.map((h) => h.length)).toEqual([10, 10, 10, 11, 11]);
  });

  it('starts with an empty pool, no winner, and the first player to act', () => {
    const game = createGame({ players: 4, firstPlayer: 2, rng: seededRng(1) });
    expect(game.pool).toEqual([]);
    expect(game.winner).toBeNull();
    expect(game.turn).toBe(2);
    expect(game.discarded).toBe(0);
  });

  it('picks a random first player when none is given', () => {
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => createGame({ players: 4, rng: seededRng(i) }).turn));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it.each([0, 1, 14, 2.5])('rejects %s players', (players) => {
    expect(() => createGame({ players })).toThrow(RangeError);
  });

  it('rejects a bad config or first player', () => {
    expect(() => createGame({ players: 3, config: { decks: 0 } })).toThrow(RangeError);
    expect(() => createGame({ players: 3, config: { maxVisibleCards: 0 } })).toThrow(RangeError);
    expect(() => createGame({ players: 3, firstPlayer: 3 })).toThrow(RangeError);
  });

  it('can use two decks', () => {
    const game = createGame({ players: 13, config: { decks: 2 }, rng: seededRng(1) });
    expect(game.hands.every((h) => h.length === 8)).toBe(true);
  });
});
