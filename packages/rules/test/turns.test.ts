import { describe, expect, it } from 'vitest';
import { applyAction, inspect, playerView, roundRank, seededRng, timeoutAction } from '../src/index.js';
import { apply, applyAll, cards, expectError, ids, stateWith } from './helpers.js';

describe('playing cards', () => {
  it('moves the cards face down into the pool and passes the turn clockwise', () => {
    const hands = [cards('K', 'K', '3'), cards('A'), cards('2')];
    const { state, events } = apply(stateWith(hands), { type: 'play', player: 0, cardIds: ids(hands[0]!.slice(0, 2)), rank: 'K' });
    expect(state.hands[0]).toEqual([hands[0]![2]]);
    expect(state.pool).toHaveLength(1);
    expect(state.pool[0]).toMatchObject({ player: 0, announcedRank: 'K', announcedCount: 2 });
    expect(state.turn).toBe(1);
    expect(events).toEqual([{ type: 'played', player: 0, count: 2, rank: 'K' }]);
  });

  it('wraps from the last seat back to seat 0', () => {
    const hands = [cards('A', 'A'), cards('2', '2'), cards('3', '3')];
    const { state } = apply(stateWith(hands, { turn: 2 }), { type: 'play', player: 2, cardIds: [hands[2]![0]!.id], rank: '3' });
    expect(state.turn).toBe(0);
  });

  it('allows lying about the rank', () => {
    const hands = [cards('2', '3'), cards('A')];
    const { state } = apply(stateWith(hands), { type: 'play', player: 0, cardIds: [hands[0]![0]!.id], rank: 'A' });
    expect(state.pool[0]!.announcedRank).toBe('A');
  });

  it('does not mutate the state it was given', () => {
    const before = stateWith([cards('A', '2'), cards('3')]);
    const snapshot = structuredClone(before);
    apply(before, { type: 'play', player: 0, cardIds: [before.hands[0]![0]!.id], rank: 'A' });
    expect(before).toEqual(snapshot);
  });

  it('rejects plays that break the rules', () => {
    const hands = [cards('A', 'A', 'A', 'A', 'A'), cards('2')];
    const s = stateWith(hands);
    const mine = ids(hands[0]!);
    expectError(s, { type: 'play', player: 1, cardIds: ids(hands[1]!), rank: '2' }, 'NOT_YOUR_TURN');
    expectError(s, { type: 'play', player: 0, cardIds: [], rank: 'A' }, 'NO_CARDS');
    expectError(s, { type: 'play', player: 0, cardIds: [mine[0]!, mine[0]!], rank: 'A' }, 'DUPLICATE_CARD');
    expectError(s, { type: 'play', player: 0, cardIds: ids(hands[1]!), rank: 'A' }, 'CARD_NOT_IN_HAND');
    expectError(s, { type: 'play', player: 0, cardIds: mine, rank: 'A' }, 'TOO_MANY_VISIBLE');
    expectError(s, { type: 'play', player: 0, cardIds: [mine[0]!], rank: 'Z' as never }, 'BAD_RANK');
    expectError(s, { type: 'play', player: 7, cardIds: [mine[0]!], rank: 'A' }, 'UNKNOWN_PLAYER');
  });
});

describe('round rank', () => {
  const h = () => [cards('A', 'A', '2'), cards('K', 'K', '3'), cards('5', '5')];

  it('makes every later play in the round announce the starter’s rank', () => {
    const hands = h();
    const s = applyAll(stateWith(hands), [{ type: 'play', player: 0, cardIds: [hands[0]![0]!.id], rank: 'A' }]);
    expect(roundRank(s)).toBe('A');
    expectError(s, { type: 'play', player: 1, cardIds: [hands[1]![0]!.id], rank: 'K' }, 'WRONG_RANK');
    // Lying with the round's rank is still allowed.
    const { state } = apply(s, { type: 'play', player: 1, cardIds: [hands[1]![0]!.id], rank: 'A' });
    expect(state.pool.map((p) => p.announcedRank)).toEqual(['A', 'A']);
  });

  it('lets the next starter pick a new rank after the round ends', () => {
    const hands = h();
    const s = applyAll(stateWith(hands), [
      { type: 'play', player: 0, cardIds: [hands[0]![0]!.id], rank: 'A' },
      { type: 'pass', player: 1 },
      { type: 'pass', player: 2 },
    ]);
    expect(roundRank(s)).toBeNull();
    expect(apply(s, { type: 'play', player: 0, cardIds: [hands[0]![2]!.id], rank: '2' }).state.pool[0]!.announcedRank).toBe('2');
  });

  it('lets the winner of a call pick a new rank', () => {
    const hands = h();
    const s = applyAll(stateWith(hands), [
      { type: 'play', player: 0, cardIds: [hands[0]![2]!.id], rank: 'A' }, // a lie
      { type: 'callBluff', player: 1 },
    ]);
    expect(s.turn).toBe(1);
    expect(roundRank(s)).toBeNull();
    expect(apply(s, { type: 'play', player: 1, cardIds: [hands[1]![0]!.id], rank: 'K' }).state.pool[0]!.announcedRank).toBe('K');
  });

  it('is shown in the player view', () => {
    const hands = h();
    const s = applyAll(stateWith(hands), [{ type: 'play', player: 0, cardIds: [hands[0]![0]!.id], rank: 'A' }]);
    expect(playerView(s, 1).roundRank).toBe('A');
    expect(playerView(stateWith(hands), 0).roundRank).toBeNull();
  });
});

describe('stacking', () => {
  const hands = () => [cards('A', 'A', 'A', 'A', '7'), cards('2')];

  it('lets 5 cards be played as 4 by hiding one under another', () => {
    const h = hands();
    const [a, b, c, d, seven] = ids(h[0]!);
    const { state, events } = apply(stateWith(h), {
      type: 'play',
      player: 0,
      cardIds: [a!, b!, c!, d!, seven!],
      stacks: [{ hidden: seven!, under: a! }],
      rank: 'A',
    });
    expect(state.hands[0]).toEqual([]);
    expect(state.pool[0]!.cards).toHaveLength(5);
    expect(state.pool[0]!.announcedCount).toBe(4);
    expect(events[0]).toEqual({ type: 'played', player: 0, count: 4, rank: 'A' });
  });

  it('rejects invalid stacks', () => {
    const h = hands();
    const s = stateWith(h);
    const [a, b, c] = ids(h[0]!);
    const play = (cardIds: string[], stacks: { hidden: string; under: string }[]) =>
      ({ type: 'play', player: 0, cardIds, stacks, rank: 'A' }) as const;

    expectError(s, play([a!, b!], [{ hidden: c!, under: a! }]), 'BAD_STACK'); // hidden card not played
    expectError(s, play([a!, b!], [{ hidden: a!, under: c! }]), 'BAD_STACK'); // target not played
    expectError(s, play([a!, b!], [{ hidden: a!, under: a! }]), 'BAD_STACK'); // under itself
    expectError(s, play([a!, b!, c!], [{ hidden: a!, under: b! }, { hidden: a!, under: c! }]), 'BAD_STACK'); // hidden twice
    expectError(s, play([a!, b!, c!], [{ hidden: a!, under: b! }, { hidden: b!, under: c! }]), 'BAD_STACK'); // chain
    expectError(s, play([a!, b!, c!], [{ hidden: a!, under: c! }, { hidden: b!, under: c! }]), 'BAD_STACK'); // two under one
  });

  it('honours a higher hidden-per-visible limit', () => {
    const h = hands();
    const [a, b, c] = ids(h[0]!);
    const s = stateWith(h);
    s.config.maxHiddenPerVisible = 2;
    const { state } = apply(s, {
      type: 'play',
      player: 0,
      cardIds: [a!, b!, c!],
      stacks: [
        { hidden: a!, under: c! },
        { hidden: b!, under: c! },
      ],
      rank: 'A',
    });
    expect(state.pool[0]!.announcedCount).toBe(1);
  });

  it('lets a game with a higher cap (x2 mode) show 8 cards, and tells players the cap', () => {
    const h = [cards('A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'), cards('2')];
    const s = stateWith(h);
    s.config.maxVisibleCards = 8;
    expect(playerView(s, 0)).toMatchObject({ maxVisible: 8, maxHiddenPerVisible: 1 });
    const eight = ids(h[0]!).slice(0, 8);
    expect(apply(s, { type: 'play', player: 0, cardIds: eight, rank: 'A' }).state.pool[0]!.announcedCount).toBe(8);
    expectError(s, { type: 'play', player: 0, cardIds: ids(h[0]!), rank: 'A' }, 'TOO_MANY_VISIBLE');
  });

  it('caps visible cards but lets hidden ones go beyond the cap', () => {
    const h = [cards('A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'), cards('2')];
    const all = ids(h[0]!);
    const stacks = [0, 1, 2, 3].map((i) => ({ hidden: all[i + 4]!, under: all[i]! }));
    const eight = all.slice(0, 8);
    const { state } = apply(stateWith(h), { type: 'play', player: 0, cardIds: eight, stacks, rank: 'A' });
    expect(state.pool[0]!.cards).toHaveLength(8);
    expect(state.pool[0]!.announcedCount).toBe(4);
  });
});

describe('inspecting', () => {
  it('shows one pile per visible card, thicker where a card is hidden, never faces', () => {
    const h = [cards('A', 'A', '7'), cards('2'), cards('3')];
    const [a, b, seven] = ids(h[0]!);
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [a!, b!, seven!], stacks: [{ hidden: seven!, under: b! }], rank: 'A' },
    ]);
    const result = inspect(s, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ player: 0, announcedRank: 'A', announcedCount: 2, piles: [1, 1.35] });
    expect(JSON.stringify(result.value)).not.toMatch(/rank"|suit|"t\d+"/);
  });

  it('jitters thickness within the noise, fixed per play', () => {
    const h = [cards('A', 'A', 'A', 'A'), cards('2')];
    const s = stateWith(h);
    s.config.inspectNoise = 0.2;
    const result = applyAction(s, { type: 'play', player: 0, cardIds: ids(h[0]!), rank: 'A' }, seededRng(3));
    if (!result.ok) throw new Error(result.error.message);
    const first = inspect(result.value.state, 1);
    const again = inspect(result.value.state, 1);
    if (!first.ok || !again.ok) throw new Error('inspect failed');
    expect(first.value.piles).toEqual(again.value.piles);
    for (const t of first.value.piles) expect(Math.abs(t - 1)).toBeLessThanOrEqual(0.2);
    expect(new Set(first.value.piles).size).toBeGreaterThan(1);
  });

  it('is only allowed for other players while the play is the latest one', () => {
    const h = [cards('A', 'A'), cards('2', '2'), cards('3', '3')];
    const s1 = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expect(inspect(s1, 0)).toMatchObject({ ok: false, error: { code: 'OWN_PLAY' } });
    expect(inspect(stateWith(h), 1)).toMatchObject({ ok: false, error: { code: 'NO_OPEN_PLAY' } });
    // Once seat 1 plays, only seat 1's play can be inspected.
    const s2 = applyAll(s1, [{ type: 'play', player: 1, cardIds: [h[1]![0]!.id], rank: 'A' }]);
    expect(inspect(s2, 0)).toMatchObject({ ok: true, value: { player: 1 } });
  });
});

describe('passing and round end', () => {
  it('does not let the round starter pass', () => {
    expectError(stateWith([cards('A'), cards('2')]), { type: 'pass', player: 0 }, 'MUST_PLAY');
  });

  it('rejects a pass out of turn', () => {
    const h = [cards('A', 'A'), cards('2'), cards('3')];
    const s = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expectError(s, { type: 'pass', player: 2 }, 'NOT_YOUR_TURN');
  });

  it('removes the pool from the game when the turn returns to the latest player', () => {
    const h = [cards('A', 'A'), cards('2', '2'), cards('3', '3')];
    const s1 = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' },
      { type: 'play', player: 1, cardIds: [h[1]![0]!.id], rank: 'A' },
      { type: 'pass', player: 2 },
    ]);
    expect(s1.pool).toHaveLength(2); // not over yet: seat 0 still to act
    const { state, events } = apply(s1, { type: 'pass', player: 0 });
    expect(events).toEqual([
      { type: 'passed', player: 0 },
      { type: 'roundEnded', visibleCount: 2, nextStarter: 1 },
    ]);
    expect(state.pool).toEqual([]);
    expect(state.discarded).toBe(2);
    expect(state.turn).toBe(1);
    expectError(state, { type: 'pass', player: 1 }, 'MUST_PLAY');
    expectError(state, { type: 'callBluff', player: 0 }, 'NO_OPEN_PLAY');
  });

  it('ends the round after one pass in a two-player game', () => {
    const h = [cards('A', 'A'), cards('2', '2')];
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' },
      { type: 'pass', player: 1 },
    ]);
    expect(s.pool).toEqual([]);
    expect(s.turn).toBe(0);
  });

  it('reports only the visible count when a stacked pool leaves the game', () => {
    const h = [cards('A', 'A', '9'), cards('2')];
    const [a, b, nine] = ids(h[0]!);
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [a!, nine!], stacks: [{ hidden: nine!, under: a! }], rank: 'A' },
    ]);
    const { state, events } = apply(s, { type: 'pass', player: 1 });
    expect(events[1]).toEqual({ type: 'roundEnded', visibleCount: 1, nextStarter: 0 });
    expect(state.discarded).toBe(2);
    expect(state.hands[0]!.map((c) => c.id)).toEqual([b]);
  });
});

describe('timeoutAction', () => {
  it('passes when passing is allowed', () => {
    const h = [cards('A', 'A'), cards('2', '2')];
    const s = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expect(timeoutAction(s)).toEqual({ type: 'pass', player: 1 });
  });

  it('plays one random card at its true rank when the player must play', () => {
    const h = [cards('5', '9'), cards('2')];
    const action = timeoutAction(stateWith(h), seededRng(5));
    expect(action).toMatchObject({ type: 'play', player: 0 });
    if (action?.type !== 'play') return;
    expect(action.cardIds).toHaveLength(1);
    const played = h[0]!.find((c) => c.id === action.cardIds[0]);
    expect(action.rank).toBe(played!.rank);
    expect(applyAction(stateWith(h), action).ok).toBe(true);
  });

  it('returns null once the game is over', () => {
    expect(timeoutAction(stateWith([cards('A'), []], { winner: 1 }))).toBeNull();
  });
});
