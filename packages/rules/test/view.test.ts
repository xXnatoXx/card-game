import { describe, expect, it } from 'vitest';
import { applyAction, createGame, playerView, seededRng, type Action, type GameState } from '../src/index.js';
import { apply, applyAll, cards, ids, stateWith, totalCards } from './helpers.js';

describe('playerView', () => {
  it('shows your own hand and only counts for everyone else', () => {
    const game = createGame({ players: 4, firstPlayer: 0, rng: seededRng(9) });
    const view = playerView(game, 2);
    expect(view.hand).toEqual(game.hands[2]);
    expect(view.handCounts).toEqual([13, 13, 13, 13]);
    const json = JSON.stringify(view);
    for (const seat of [0, 1, 3]) {
      for (const c of game.hands[seat]!) expect(json).not.toContain(`"${c.id}"`);
    }
  });

  it('never exposes pool faces or a stack in the hand count or pool size', () => {
    const h = [cards('A', 'A', '7', '3'), cards('2', '2'), cards('3', '3')];
    const [a, b, seven] = ids(h[0]!);
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [a!, b!, seven!], stacks: [{ hidden: seven!, under: a! }], rank: 'A' },
    ]);
    const view = playerView(s, 1);
    expect(view.poolCount).toBe(2);
    expect(view.handCounts[0]).toBe(2); // really 1: the stack is not given away
    expect(view.latest).toEqual({ player: 0, rank: 'A', count: 2 });
    const json = JSON.stringify(view);
    for (const c of h[0]!) expect(json).not.toContain(`"${c.id}"`);

    // The stacker sees their real count.
    expect(playerView(s, 0).handCounts[0]).toBe(1);
  });

  it('corrects the shown count once a stack is revealed by a call', () => {
    const h = [cards('A', 'A', '7', '3'), cards('2', '2'), cards('3', '3')];
    const [a, b, seven] = ids(h[0]!);
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [a!, b!, seven!], stacks: [{ hidden: seven!, under: a! }], rank: 'A' },
      { type: 'callBluff', player: 2 },
    ]);
    expect(playerView(s, 1).handCounts).toEqual([4, 2, 2]);
    expect(s.shownHandCounts).toEqual(s.hands.map((hand) => hand.length));
  });

  it('reports what the viewer may do', () => {
    const h = [cards('A', 'A'), cards('2', '2'), cards('3', '3')];
    const start = stateWith(h);
    expect(playerView(start, 0)).toMatchObject({ canPlay: true, canPass: false, canCall: false, canInspect: false });
    const s = applyAll(start, [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expect(playerView(s, 0)).toMatchObject({ canPlay: false, canPass: false, canCall: false });
    expect(playerView(s, 1)).toMatchObject({ canPlay: true, canPass: true, canCall: true, canInspect: true });
    expect(playerView(s, 2)).toMatchObject({ canPlay: false, canPass: false, canCall: true });
  });

  it('rejects an unknown seat', () => {
    expect(() => playerView(stateWith([cards('A'), cards('2')]), 5)).toThrow(RangeError);
  });
});

describe('random games', () => {
  /** Picks a random action that may or may not be legal, like an unreliable client would. */
  function randomAction(state: GameState, rng: () => number): Action {
    const players = state.hands.length;
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;
    if (state.pool.length > 0 && rng() < 0.15) return { type: 'callBluff', player: Math.floor(rng() * players) };

    const player = rng() < 0.9 ? state.turn : Math.floor(rng() * players);
    if (state.pool.length > 0 && rng() < 0.3) return { type: 'pass', player };

    const hand = [...state.hands[player]!];
    const count = Math.min(hand.length, 1 + Math.floor(rng() * 6));
    const chosen: string[] = [];
    while (chosen.length < count) chosen.push(hand.splice(Math.floor(rng() * hand.length), 1)[0]!.id);
    const stacks = chosen.length > 1 && rng() < 0.3 ? [{ hidden: chosen[0]!, under: chosen[1]! }] : [];
    const own = state.hands[player]![0]?.rank;
    const roundRank = state.pool[0]?.announcedRank;
    // Mostly follow the round's rank; sometimes try an illegal one, which must be rejected.
    const rank = roundRank && rng() < 0.9 ? roundRank : own && rng() < 0.5 ? own : pick(['A', '5', 'K'] as const);
    return { type: 'play', player, cardIds: chosen, stacks, rank };
  }

  it('keeps every card accounted for and always reaches a winner', () => {
    let finished = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seededRng(seed);
      const players = 2 + (seed % 12);
      let state = createGame({ players, rng });
      const decks = state.config.decks;

      for (let step = 0; step < 5000 && state.winner === null; step++) {
        const result = applyAction(state, randomAction(state, rng), rng);
        if (!result.ok) continue;
        state = result.value.state;

        expect(totalCards(state)).toBe(52 * decks);
        const allIds = [...state.hands.flat(), ...state.pool.flatMap((p) => p.cards)].map((c) => c.id);
        expect(new Set(allIds).size).toBe(allIds.length);
        for (const p of state.pool) {
          expect(p.announcedRank).toBe(state.pool[0]!.announcedRank);
          expect(p.announcedCount).toBe(p.cards.length - p.stacks.length);
          expect(p.announcedCount).toBeGreaterThanOrEqual(1);
          expect(p.announcedCount).toBeLessThanOrEqual(4);
        }
        // Nobody can have an empty hand except the player whose play is still open.
        const open = state.pool.at(-1)?.player;
        if (state.winner === null) {
          state.hands.forEach((hand, seat) => {
            if (hand.length === 0) expect(seat).toBe(open);
          });
        } else {
          expect(state.hands[state.winner]).toEqual([]);
        }
      }
      if (state.winner !== null) finished++;
    }
    expect(finished).toBe(200);
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const rng = seededRng(77);
      let state = createGame({ players: 5, rng });
      for (let i = 0; i < 300 && state.winner === null; i++) {
        const r = applyAction(state, randomAction(state, rng), rng);
        if (r.ok) state = r.value.state;
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
});

it('the shown count of a single honest player always matches reality', () => {
  // With no stacks at all, shown counts never drift.
  const h = [cards('A', 'A', 'A'), cards('2', '2', '2')];
  let s = stateWith(h);
  s = apply(s, { type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }).state;
  s = apply(s, { type: 'callBluff', player: 1 }).state;
  s = apply(s, { type: 'play', player: 0, cardIds: [h[0]![1]!.id], rank: 'K' }).state;
  s = apply(s, { type: 'callBluff', player: 1 }).state;
  expect(s.shownHandCounts).toEqual(s.hands.map((hand) => hand.length));
});
