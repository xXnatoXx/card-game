import type { Card, Rank } from './cards.js';

/** A player's position at the table, 0-based. Turns go clockwise: seat n is followed by seat n + 1. */
export type Seat = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 13;

/** The "assumed details" from the design doc, section 4. Each one is a default, not a decision. */
export interface GameConfig {
  /** Standard 52-card decks shuffled together. */
  decks: number;
  /** Most cards that may be visible in a single play. The fewest is always 1. */
  maxVisibleCards: number;
  /** Most cards that may be hidden under each visible card. */
  maxHiddenPerVisible: number;
  /** Extra thickness an inspected pile shows per hidden card. A plain card is 1.0. */
  stackTell: number;
  /** Each pile's thickness is jittered by up to this much, so inspecting is a read, not a proof. */
  inspectNoise: number;
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = {
  decks: 1,
  maxVisibleCards: 4,
  maxHiddenPerVisible: 1,
  stackTell: 0.35,
  inspectNoise: 0.2,
};

/** `hidden` is placed under `under`. Both are card ids from the same play. */
export interface Stack {
  hidden: string;
  under: string;
}

/** One play sitting in the pool. Server-only: it holds real faces and the real count. */
export interface Play {
  player: Seat;
  /** Every card really played, hidden ones included, in the order the player listed them. */
  cards: Card[];
  stacks: Stack[];
  announcedRank: Rank;
  /** Number of visible cards. Always what the player announces. */
  announcedCount: number;
  /** What inspecting shows: one thickness per visible card, fixed when the play is made. */
  piles: number[];
}

/**
 * Full game state. Plain JSON-safe data that never leaves the server.
 * Functions in this module never mutate a state they are given; they return a new one.
 */
export interface GameState {
  config: GameConfig;
  /** Real hands, by seat. */
  hands: Card[][];
  /**
   * Hand sizes as the table can know them: they move by announced counts, not real ones.
   * Sending real hand sizes would reveal every stack, since a player's hand shrinks by more
   * than the number of cards everyone saw. See `playerView`.
   */
  shownHandCounts: number[];
  /** Plays this round, oldest first. Only the last one can be inspected or called. */
  pool: Play[];
  turn: Seat;
  /** Real number of cards that have left the game at round ends. */
  discarded: number;
  winner: Seat | null;
}

export type Action =
  | { type: 'play'; player: Seat; cardIds: readonly string[]; stacks?: readonly Stack[]; rank: Rank }
  | { type: 'pass'; player: Seat }
  | { type: 'callBluff'; player: Seat };

/** Things that happened, in order, for the server to broadcast. None of them leak hidden information. */
export type GameEvent =
  | { type: 'played'; player: Seat; count: number; rank: Rank }
  | { type: 'passed'; player: Seat }
  | {
      type: 'revealed';
      caller: Seat;
      player: Seat;
      /** The called play's real cards, hidden ones included. */
      cards: Card[];
      announcedRank: Rank;
      announcedCount: number;
      wasBluff: boolean;
      /** Who takes the pool. */
      loser: Seat;
      /** Pool size as the table saw it, with the called play at its real count. */
      cardsTaken: number;
      nextStarter: Seat;
    }
  | {
      type: 'roundEnded';
      /** Visible cards that left the game. The real number is never revealed. */
      visibleCount: number;
      nextStarter: Seat;
    }
  | { type: 'gameOver'; winner: Seat };

export type RuleErrorCode =
  | 'GAME_OVER'
  | 'UNKNOWN_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'NO_CARDS'
  | 'DUPLICATE_CARD'
  | 'CARD_NOT_IN_HAND'
  | 'BAD_STACK'
  | 'TOO_MANY_VISIBLE'
  | 'BAD_RANK'
  | 'WRONG_RANK'
  | 'MUST_PLAY'
  | 'NO_OPEN_PLAY'
  | 'OWN_PLAY';

export interface RuleError {
  code: RuleErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: RuleError };

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

/** What a player sees when inspecting the latest play. Never contains faces. */
export interface InspectView {
  player: Seat;
  announcedRank: Rank;
  announcedCount: number;
  /** One thickness per visible card. Around 1.0 for a single card, more if something is hidden under it. */
  piles: number[];
}

/** Everything one player is allowed to know. Safe to send to that player as-is. */
export interface PlayerView {
  seat: Seat;
  hand: Card[];
  /** By seat. Your own entry is real; everyone else's is the shown count. */
  handCounts: number[];
  turn: Seat;
  /** Visible cards in the pool. */
  poolCount: number;
  latest: { player: Seat; rank: Rank; count: number } | null;
  /** Set by the round's first play; every play this round must announce it. Null when you start a round. */
  roundRank: Rank | null;
  /** Most cards a play may show (4 per deck), and most that may hide under each shown card. */
  maxVisible: number;
  maxHiddenPerVisible: number;
  canPlay: boolean;
  canPass: boolean;
  canCall: boolean;
  canInspect: boolean;
  winner: Seat | null;
}
