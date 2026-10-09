import { RANKS, type Card, type InspectView, type PlayerView, type Rank, type Rng, type Stack } from '@bluff/rules';
import type { PlayPayload } from '@bluff/protocol';

// Bots only use what a player could know: their own hand, the public view, and inspections.

export type BotTurn = { type: 'pass' } | { type: 'play'; payload: PlayPayload };

export function chooseTurn(view: PlayerView, rng: Rng): BotTurn {
  let rank: Rank;
  let cards: Card[];
  if (view.roundRank) {
    // The round's rank is fixed: play real ones if we have them, otherwise bluff or pass.
    rank = view.roundRank;
    cards = view.hand.filter((c) => c.rank === rank);
    if (view.canPass && rng() < (cards.length > 0 ? 0.15 : 0.5)) return { type: 'pass' };
    if (cards.length === 0) {
      const fake = view.hand[Math.floor(rng() * view.hand.length)]!;
      return { type: 'play', payload: { cardIds: [fake.id], stacks: [], rank } };
    }
  } else {
    // Starting a round: lead with the biggest group, breaking ties at random.
    const groups = groupByRank(view.hand);
    groups.sort((a, b) => b.cards.length - a.cards.length || rng() - 0.5);
    ({ rank, cards } = groups[0]!);
  }
  const chosen = cards.slice(0, view.maxVisible);
  const others = view.hand.filter((c) => !chosen.includes(c));
  const stacks: Stack[] = [];

  const lie = others[Math.floor(rng() * others.length)];
  if (lie && chosen.length < view.maxVisible && rng() < 0.2) {
    // Pass an off-rank card off as one more of the rank.
    chosen.push(lie);
  } else if (lie && rng() < 0.15) {
    // Hide an off-rank card under the first card.
    chosen.push(lie);
    stacks.push({ hidden: lie.id, under: chosen[0]!.id });
  }
  return { type: 'play', payload: { cardIds: chosen.map((c) => c.id), stacks, rank } };
}

/** Whether to call the latest play. `perRank` is how many of each rank exist (4 per deck). */
export function chooseCall(view: PlayerView, look: InspectView | null, rng: Rng, perRank: number): boolean {
  const latest = view.latest;
  if (!latest || !view.canCall) return false;
  const held = view.hand.filter((c) => c.rank === latest.rank).length;
  if (held + latest.count > perRank) return rng() < 0.95; // impossible claim

  let chance = 0.05 + 0.06 * (latest.count - 1) + 0.08 * held;
  if (look && Math.max(...look.piles) > 1.2) chance += 0.45;
  if (view.handCounts[latest.player] === 0) chance += 0.5; // they win unless caught
  return rng() < Math.min(chance, 0.9);
}

/** Bots inspect bigger plays more often. */
export function wantsInspect(view: PlayerView, rng: Rng): boolean {
  return (view.latest?.count ?? 0) >= 2 && rng() < 0.6;
}

function groupByRank(hand: readonly Card[]): { rank: Rank; cards: Card[] }[] {
  return RANKS.map((rank) => ({ rank, cards: hand.filter((c) => c.rank === rank) })).filter((g) => g.cards.length > 0);
}
