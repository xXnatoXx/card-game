import { canChallenge, canPass, roundRank, visibleCount } from './game.js';
import type { GameState, PlayerView, Seat } from './types.js';

/**
 * Projects the full state down to what `seat` may know: their own hand, everyone's shown hand
 * count, and the latest announcement. Never includes other hands, pool faces, or real pool size.
 *
 * Shown counts can drift from real ones. A stacker whose stack goes unrevealed shows more cards than
 * they hold, and whoever picks up an unrevealed stack shows fewer. Counts are clamped at zero.
 */
export function playerView(state: GameState, seat: Seat): PlayerView {
  const hand = state.hands[seat];
  if (!hand) throw new RangeError(`There is no seat ${seat}.`);
  const latest = state.pool.at(-1);
  const challenge = canChallenge(state, seat);

  return {
    seat,
    hand: structuredClone(hand),
    handCounts: state.shownHandCounts.map((n, s) => (s === seat ? hand.length : Math.max(0, n))),
    turn: state.turn,
    poolCount: visibleCount(state.pool),
    latest: latest ? { player: latest.player, rank: latest.announcedRank, count: latest.announcedCount } : null,
    roundRank: roundRank(state),
    maxVisible: state.config.maxVisibleCards,
    maxHiddenPerVisible: state.config.maxHiddenPerVisible,
    canPlay: state.winner === null && state.turn === seat,
    canPass: canPass(state, seat),
    canCall: challenge,
    canInspect: challenge,
    winner: state.winner,
  };
}
