import { describe, expect, it } from 'vitest';
import { inspect } from '../src/index.js';
import { apply, applyAll, cards, expectError, ids, stateWith } from './helpers.js';

describe('calling a bluff', () => {
  it('honest play: the caller takes the whole pool and the called player starts', () => {
    const h = [cards('K', 'K', '4'), cards('K', 'K', '5'), cards('3', '3')];
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: ids(h[0]!.slice(0, 2)), rank: 'K' },
      { type: 'play', player: 1, cardIds: ids(h[1]!.slice(0, 2)), rank: 'K' },
    ]);
    const { state, events } = apply(s, { type: 'callBluff', player: 2 });
    expect(events).toEqual([
      {
        type: 'revealed',
        caller: 2,
        player: 1,
        cards: h[1]!.slice(0, 2),
        announcedRank: 'K',
        announcedCount: 2,
        wasBluff: false,
        loser: 2,
        cardsTaken: 4,
        nextStarter: 1,
      },
    ]);
    expect(state.hands[2]).toHaveLength(6);
    expect(state.pool).toEqual([]);
    expect(state.turn).toBe(1);
  });

  it('wrong rank: the bluffer takes the pool and the caller starts', () => {
    const h = [cards('K', '4'), cards('Q', '5'), cards('3', '3')];
    const s = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![1]!.id], rank: 'K' }]);
    const { state, events } = apply(s, { type: 'callBluff', player: 1 });
    expect(events[0]).toMatchObject({ wasBluff: true, loser: 0, nextStarter: 1, cardsTaken: 1 });
    expect(state.hands[0]).toHaveLength(2);
    expect(state.turn).toBe(1);
  });

  it('a stack is a bluff even when every card is the announced rank', () => {
    const h = [cards('A', 'A', 'A'), cards('2'), cards('3')];
    const [a, b, c] = ids(h[0]!);
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [a!, b!, c!], stacks: [{ hidden: c!, under: a! }], rank: 'A' },
    ]);
    const { state, events } = apply(s, { type: 'callBluff', player: 2 });
    expect(events[0]).toMatchObject({ wasBluff: true, loser: 0, nextStarter: 2, announcedCount: 2 });
    if (events[0]?.type !== 'revealed') throw new Error('expected a reveal');
    expect(events[0].cards).toHaveLength(3); // stacked card is revealed too
    expect(state.hands[0]).toHaveLength(3);
  });

  it('any other player may call, not only the next one, even off-turn', () => {
    const h = [cards('A', 'A'), cards('2', '2'), cards('3', '3'), cards('4', '4')];
    const s = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expect(s.turn).toBe(1);
    const { state } = apply(s, { type: 'callBluff', player: 3 });
    expect(state.turn).toBe(0); // honest play: called player starts
    expect(state.hands[3]).toHaveLength(3);
  });

  it('stays open while players pass', () => {
    const h = [cards('A', 'A'), cards('2', '2'), cards('3', '3')];
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'K' },
      { type: 'pass', player: 1 },
    ]);
    const { events } = apply(s, { type: 'callBluff', player: 1 });
    expect(events[0]).toMatchObject({ wasBluff: true, caller: 1 });
  });

  it('closes for a play once the next player plays cards', () => {
    const h = [cards('A', 'A'), cards('K', 'K'), cards('3', '3')];
    const s = applyAll(stateWith(h), [
      { type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'K' }, // a lie
      { type: 'play', player: 1, cardIds: [h[1]![0]!.id], rank: 'K' }, // honest
    ]);
    const { events } = apply(s, { type: 'callBluff', player: 2 });
    expect(events[0]).toMatchObject({ player: 1, wasBluff: false, loser: 2, cardsTaken: 2 });
  });

  it('rejects calling your own play, an empty pool, or after the game ends', () => {
    const h = [cards('A', 'A'), cards('2', '2')];
    expectError(stateWith(h), { type: 'callBluff', player: 1 }, 'NO_OPEN_PLAY');
    const s = applyAll(stateWith(h), [{ type: 'play', player: 0, cardIds: [h[0]![0]!.id], rank: 'A' }]);
    expectError(s, { type: 'callBluff', player: 0 }, 'OWN_PLAY');
    expectError({ ...s, winner: 1 }, { type: 'callBluff', player: 1 }, 'GAME_OVER');
  });
});

describe('winning', () => {
  const lastCardsState = (honest: boolean) => {
    const h = [cards('A', '7'), cards('2', '2'), cards('3', '3')];
    // Seat 0 plays its last two cards as "2 aces" — true only if `honest`.
    const hand0 = honest ? cards('A', 'A') : h[0]!;
    const hands = [hand0, h[1]!, h[2]!];
    const s = applyAll(stateWith(hands), [{ type: 'play', player: 0, cardIds: ids(hand0), rank: 'A' }]);
    return s;
  };

  it('does not end the game while the emptying play can still be called', () => {
    const s = lastCardsState(true);
    expect(s.hands[0]).toEqual([]);
    expect(s.winner).toBeNull();
  });

  it('declares the winner once the next player plays cards', () => {
    const s = lastCardsState(false);
    const { state, events } = apply(s, { type: 'play', player: 1, cardIds: [s.hands[1]![0]!.id], rank: 'A' });
    expect(state.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: 0 });
    expectError(state, { type: 'pass', player: 2 }, 'GAME_OVER');
    expect(inspect(state, 2)).toMatchObject({ ok: false, error: { code: 'GAME_OVER' } });
  });

  it('declares the winner when the round ends without a call', () => {
    const s = applyAll(lastCardsState(false), [{ type: 'pass', player: 1 }]);
    expect(s.winner).toBeNull();
    const { state, events } = apply(s, { type: 'pass', player: 2 });
    expect(events.map((e) => e.type)).toEqual(['passed', 'roundEnded', 'gameOver']);
    expect(state.winner).toBe(0);
  });

  it('declares the winner when a call on an honest last play fails', () => {
    const { state, events } = apply(lastCardsState(true), { type: 'callBluff', player: 2 });
    expect(events.map((e) => e.type)).toEqual(['revealed', 'gameOver']);
    expect(state.winner).toBe(0);
  });

  it('makes a caught bluffer pick up the pool and keep playing', () => {
    const { state, events } = apply(lastCardsState(false), { type: 'callBluff', player: 1 });
    expect(events.map((e) => e.type)).toEqual(['revealed']);
    expect(state.winner).toBeNull();
    expect(state.hands[0]).toHaveLength(2);
    expect(state.turn).toBe(1);
  });
});

describe('the example from the design doc', () => {
  it('plays out Ann, Ben and Cho', () => {
    const [ANN, BEN, CHO] = [0, 1, 2];
    // Same story as the doc, but Ben must follow Ann's rank, so he claims kings rather than aces.
    const ann = cards('K', 'K', 'Q', '9', '9');
    const ben = cards('K', 'K', 'A', '6', '8', '5');
    const cho = cards('4', '4', 'J', 'J');
    let s = stateWith([ann, ben, cho]);

    // Ann plays 2 cards and says "2 kings". Nobody calls.
    s = apply(s, { type: 'play', player: ANN, cardIds: ids(ann.slice(0, 2)), rank: 'K' }).state;

    // Ben selects 5 cards, stacks one under another, and says "4 kings".
    const [k1, k2, ace, six, eight] = ids(ben);
    const benPlay = apply(s, {
      type: 'play',
      player: BEN,
      cardIds: [k1!, k2!, ace!, six!, eight!],
      stacks: [{ hidden: eight!, under: k2! }],
      rank: 'K',
    });
    expect(benPlay.events).toEqual([{ type: 'played', player: BEN, count: 4, rank: 'K' }]);
    s = benPlay.state;

    // Cho inspects and sees one pile thicker than the rest.
    const look = inspect(s, CHO);
    if (!look.ok) throw new Error(look.error.message);
    expect(look.value.piles).toEqual([1, 1.35, 1, 1]);

    // Cho calls. 5 cards are revealed: a bluff, so Ben takes all 7 and Cho starts.
    const call = apply(s, { type: 'callBluff', player: CHO });
    expect(call.events[0]).toMatchObject({ wasBluff: true, loser: BEN, nextStarter: CHO, cardsTaken: 7 });
    s = call.state;
    expect(s.hands[BEN]).toHaveLength(8);
    expect(s.turn).toBe(CHO);

    // Cho starts a new round with fours, so Ann must claim a four too. Ben and Cho pass: Ann starts next.
    s = applyAll(s, [
      { type: 'play', player: CHO, cardIds: ids(cho.slice(0, 2)), rank: '4' },
      { type: 'play', player: ANN, cardIds: [ann[2]!.id], rank: '4' },
      { type: 'pass', player: BEN },
    ]);
    const end = apply(s, { type: 'pass', player: CHO });
    expect(end.events).toContainEqual({ type: 'roundEnded', visibleCount: 3, nextStarter: ANN });
    expect(end.state.pool).toEqual([]);
    expect(end.state.turn).toBe(ANN);
  });
});
