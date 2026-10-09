import { createShuffledDeck, isRank, type Card, type Rank, type Rng } from './cards.js';
import {
  DEFAULT_CONFIG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
  type InspectView,
  type Play,
  type Result,
  type RuleErrorCode,
  type Seat,
  type Stack,
  type Transition,
} from './types.js';

export interface NewGameOptions {
  players: number;
  config?: Partial<GameConfig>;
  /** Shuffles the deck, picks the first player, and jitters inspect piles. Defaults to Math.random. */
  rng?: Rng;
  /** Seat that deals first and starts the first round. Random if omitted. */
  firstPlayer?: Seat;
}

/** Shuffles, deals every card one at a time starting with the first player, and opens the first round. */
export function createGame(options: NewGameOptions): GameState {
  const { players } = options;
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) {
    throw new RangeError(`A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players, got ${players}.`);
  }
  const config: GameConfig = { ...DEFAULT_CONFIG, ...options.config };
  assertConfig(config);

  const rng = options.rng ?? Math.random;
  const deck = createShuffledDeck(config.decks, rng);
  const first = options.firstPlayer ?? Math.floor(rng() * players);
  if (!Number.isInteger(first) || first < 0 || first >= players) {
    throw new RangeError(`firstPlayer must be a seat from 0 to ${players - 1}, got ${first}.`);
  }

  const hands: Card[][] = Array.from({ length: players }, () => []);
  deck.forEach((card, i) => hands[(first + i) % players]!.push(card));

  return {
    config,
    hands,
    shownHandCounts: hands.map((hand) => hand.length),
    pool: [],
    turn: first,
    discarded: 0,
    winner: null,
  };
}

/** Validates and applies one action. Never throws for a bad action; returns an error instead. */
export function applyAction(state: GameState, action: Action, rng: Rng = Math.random): Result<Transition> {
  if (state.winner !== null) return fail('GAME_OVER', 'The game is over.');
  if (!isSeat(state, action.player)) return fail('UNKNOWN_PLAYER', `There is no seat ${action.player}.`);

  switch (action.type) {
    case 'play':
      return play(state, action, rng);
    case 'pass':
      return pass(state, action.player);
    case 'callBluff':
      return callBluff(state, action.player);
  }
}

/** Close-up of the latest play, face down. Any player but the one who made it, until the window closes. */
export function inspect(state: GameState, seat: Seat): Result<InspectView> {
  const latest = openPlayFor(state, seat);
  if (!latest.ok) return latest;
  const { player, announcedRank, announcedCount, piles } = latest.value;
  return { ok: true, value: { player, announcedRank, announcedCount, piles: [...piles] } };
}

/**
 * What the server does for a player whose turn timer runs out: pass if allowed, otherwise
 * play one random card and announce its true rank. Returns null once the game is over.
 */
export function timeoutAction(state: GameState, rng: Rng = Math.random): Action | null {
  if (state.winner !== null) return null;
  const player = state.turn;
  if (state.pool.length > 0) return { type: 'pass', player };
  const hand = state.hands[player]!;
  const card = hand[Math.floor(rng() * hand.length)]!;
  return { type: 'play', player, cardIds: [card.id], rank: card.rank };
}

export function canPass(state: GameState, seat: Seat): boolean {
  return state.winner === null && state.turn === seat && state.pool.length > 0;
}

/** True when `seat` may inspect or call the latest play. */
export function canChallenge(state: GameState, seat: Seat): boolean {
  return openPlayFor(state, seat).ok;
}

export function nextSeat(state: GameState, seat: Seat): Seat {
  return (seat + 1) % state.hands.length;
}

/** The rank the round's first play announced. Every later play in the round must announce it too. */
export function roundRank(state: GameState): Rank | null {
  return state.pool[0]?.announcedRank ?? null;
}

export function visibleCount(pool: readonly Play[]): number {
  return pool.reduce((sum, p) => sum + p.announcedCount, 0);
}

function play(state: GameState, action: Extract<Action, { type: 'play' }>, rng: Rng): Result<Transition> {
  const { player, rank } = action;
  if (player !== state.turn) return fail('NOT_YOUR_TURN', 'It is not your turn.');
  if (!isRank(rank)) return fail('BAD_RANK', `"${String(rank)}" is not a rank.`);
  const required = roundRank(state);
  if (required && rank !== required) {
    return fail('WRONG_RANK', `This round is ${required}s: every play must be announced as ${required}.`);
  }

  const cardIds = action.cardIds;
  const stacks = action.stacks ?? [];
  if (cardIds.length === 0) return fail('NO_CARDS', 'Choose at least one card to play.');
  const played = new Set(cardIds);
  if (played.size !== cardIds.length) return fail('DUPLICATE_CARD', 'The same card was chosen twice.');

  const hand = state.hands[player]!;
  const byId = new Map(hand.map((card) => [card.id, card]));
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = byId.get(id);
    if (!card) return fail('CARD_NOT_IN_HAND', `Card ${id} is not in your hand.`);
    cards.push(card);
  }

  const stackCheck = checkStacks(stacks, played, state.config.maxHiddenPerVisible);
  if (!stackCheck.ok) return stackCheck;
  const hiddenUnder = stackCheck.value;

  const hidden = new Set(stacks.map((s) => s.hidden));
  const visibleIds = cardIds.filter((id) => !hidden.has(id));
  if (visibleIds.length > state.config.maxVisibleCards) {
    return fail('TOO_MANY_VISIBLE', `At most ${state.config.maxVisibleCards} cards can be visible in one play.`);
  }

  const { stackTell, inspectNoise } = state.config;
  const piles = visibleIds.map((id) => {
    const base = 1 + stackTell * (hiddenUnder.get(id) ?? 0);
    return round3(base + (rng() * 2 - 1) * inspectNoise);
  });

  const next = structuredClone(state);
  next.hands[player] = next.hands[player]!.filter((card) => !played.has(card.id));
  next.pool.push({
    player,
    cards: structuredClone(cards),
    stacks: stacks.map((s) => ({ ...s })),
    announcedRank: rank,
    announcedCount: visibleIds.length,
    piles,
  });
  next.shownHandCounts[player]! -= visibleIds.length;
  next.turn = nextSeat(next, player);

  return finish(next, [{ type: 'played', player, count: visibleIds.length, rank }]);
}

function pass(state: GameState, player: Seat): Result<Transition> {
  if (player !== state.turn) return fail('NOT_YOUR_TURN', 'It is not your turn.');
  const latest = state.pool.at(-1);
  if (!latest) return fail('MUST_PLAY', 'You start this round, so you must play cards.');

  const next = structuredClone(state);
  const to = nextSeat(next, player);
  const events: GameEvent[] = [{ type: 'passed', player }];

  if (to === latest.player) {
    // Everyone else passed: the pool leaves the game unrevealed.
    next.discarded += next.pool.reduce((sum, p) => sum + p.cards.length, 0);
    events.push({ type: 'roundEnded', visibleCount: visibleCount(next.pool), nextStarter: to });
    next.pool = [];
  }
  next.turn = to;
  return finish(next, events);
}

function callBluff(state: GameState, caller: Seat): Result<Transition> {
  const open = openPlayFor(state, caller);
  if (!open.ok) return open;
  const called = open.value;

  const wasBluff =
    called.cards.length !== called.announcedCount || called.cards.some((card) => card.rank !== called.announcedRank);
  const loser = wasBluff ? called.player : caller;
  const nextStarter = wasBluff ? caller : called.player;
  const hiddenInCalled = called.cards.length - called.announcedCount;
  // The table now knows the called play's real size; the rest of the pool stays at its visible size.
  const cardsTaken = visibleCount(state.pool) + hiddenInCalled;

  const next = structuredClone(state);
  next.hands[loser]!.push(...next.pool.flatMap((p) => p.cards));
  next.shownHandCounts[called.player]! -= hiddenInCalled;
  next.shownHandCounts[loser]! += cardsTaken;
  next.pool = [];
  next.turn = nextStarter;

  return finish(next, [
    {
      type: 'revealed',
      caller,
      player: called.player,
      cards: structuredClone(called.cards),
      announcedRank: called.announcedRank,
      announcedCount: called.announcedCount,
      wasBluff,
      loser,
      cardsTaken,
      nextStarter,
    },
  ]);
}

/**
 * Ends the game if someone has won. A player with an empty hand wins unless their last play is
 * still open to a call: they win once the next player plays, the round ends, or a call on that
 * play fails. A successful call refills their hand instead.
 */
function finish(next: GameState, events: GameEvent[]): Result<Transition> {
  const openPlayer = next.pool.at(-1)?.player;
  const winner = next.hands.findIndex((hand, seat) => hand.length === 0 && seat !== openPlayer);
  if (winner !== -1) {
    next.winner = winner;
    events.push({ type: 'gameOver', winner });
  }
  return { ok: true, value: { state: next, events } };
}

/** Returns, for each visible card, how many cards are hidden under it. */
function checkStacks(
  stacks: readonly Stack[],
  played: ReadonlySet<string>,
  maxHiddenPerVisible: number,
): Result<Map<string, number>> {
  const hidden = new Set<string>();
  const hiddenUnder = new Map<string, number>();
  for (const { hidden: h, under } of stacks) {
    if (!played.has(h) || !played.has(under)) return fail('BAD_STACK', 'Only cards in this play can be stacked.');
    if (h === under) return fail('BAD_STACK', 'A card cannot be stacked under itself.');
    if (hidden.has(h)) return fail('BAD_STACK', 'A card can only be hidden once.');
    hidden.add(h);
    hiddenUnder.set(under, (hiddenUnder.get(under) ?? 0) + 1);
  }
  for (const [under, count] of hiddenUnder) {
    if (hidden.has(under)) return fail('BAD_STACK', 'Cards can only be hidden under a visible card.');
    if (count > maxHiddenPerVisible) {
      return fail('BAD_STACK', `At most ${maxHiddenPerVisible} card(s) can be hidden under each visible card.`);
    }
  }
  return { ok: true, value: hiddenUnder };
}

function openPlayFor(state: GameState, seat: Seat): Result<Play> {
  if (state.winner !== null) return fail('GAME_OVER', 'The game is over.');
  if (!isSeat(state, seat)) return fail('UNKNOWN_PLAYER', `There is no seat ${seat}.`);
  const latest = state.pool.at(-1);
  if (!latest) return fail('NO_OPEN_PLAY', 'There is no play to inspect or call.');
  if (latest.player === seat) return fail('OWN_PLAY', 'You cannot inspect or call your own play.');
  return { ok: true, value: latest };
}

function isSeat(state: GameState, seat: unknown): seat is Seat {
  return Number.isInteger(seat) && (seat as number) >= 0 && (seat as number) < state.hands.length;
}

function assertConfig(config: GameConfig): void {
  const wholeAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min;
  if (!wholeAtLeast(config.decks, 1)) throw new RangeError('decks must be a whole number of at least 1.');
  if (!wholeAtLeast(config.maxVisibleCards, 1)) throw new RangeError('maxVisibleCards must be at least 1.');
  if (!wholeAtLeast(config.maxHiddenPerVisible, 0)) throw new RangeError('maxHiddenPerVisible must be at least 0.');
  if (!(config.stackTell >= 0) || !(config.inspectNoise >= 0)) {
    throw new RangeError('stackTell and inspectNoise must not be negative.');
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fail(code: RuleErrorCode, message: string): { ok: false; error: { code: RuleErrorCode; message: string } } {
  return { ok: false, error: { code, message } };
}
