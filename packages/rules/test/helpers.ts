import { expect } from 'vitest';
import {
  applyAction,
  DEFAULT_CONFIG,
  seededRng,
  type Action,
  type Card,
  type GameState,
  type Rank,
  type RuleErrorCode,
  type Suit,
  type Transition,
} from '../src/index.js';

let nextId = 0;

export function card(rank: Rank, suit: Suit = 'spades'): Card {
  return { id: `t${nextId++}`, rank, suit };
}

export function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => card(rank));
}

export function ids(list: readonly Card[]): string[] {
  return list.map((c) => c.id);
}

/** A game in progress with chosen hands. Inspect noise is off so thickness is exact. */
export function stateWith(hands: Card[][], overrides: Partial<GameState> = {}): GameState {
  return {
    config: { ...DEFAULT_CONFIG, inspectNoise: 0 },
    hands,
    shownHandCounts: hands.map((h) => h.length),
    pool: [],
    turn: 0,
    discarded: 0,
    winner: null,
    ...overrides,
  };
}

/** Applies an action that must succeed. */
export function apply(state: GameState, action: Action): Transition {
  const result = applyAction(state, action, seededRng(1));
  if (!result.ok) throw new Error(`Expected ${action.type} to succeed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

/** Applies a chain of actions that must all succeed, returning the final state. */
export function applyAll(state: GameState, actions: Action[]): GameState {
  return actions.reduce((s, action) => apply(s, action).state, state);
}

export function expectError(state: GameState, action: Action, code: RuleErrorCode): void {
  const result = applyAction(state, action, seededRng(1));
  expect(result.ok ? 'ok' : result.error.code).toBe(code);
}

export function totalCards(state: GameState): number {
  return state.hands.reduce((n, h) => n + h.length, 0) + state.pool.reduce((n, p) => n + p.cards.length, 0) + state.discarded;
}
