import type { Card, PlayerState } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';

/**
 * Defensive vs aggressive race posture for a bot.
 *
 * Red 10 scoring rewards finishing before the LAST player, not first. When a
 * bot has bad cards (lots of low singletons, few winners) and an opponent is
 * close to exit, racing is futile — burning bombs/A-pairs/red-10s to win
 * tricks just exhausts winners that won't accelerate exit. Defensive mode
 * tells the bot: pass more, conserve winners, opportunistically play low
 * cards when possible. Aggressive (default) is the existing P-rule behavior.
 *
 * Mode is recomputed every decision — it's stateless and a function of
 * current hand + opponents' hand sizes + team info.
 */
export type RaceMode = 'aggressive' | 'defensive';

export interface RaceAssessment {
  mode: RaceMode;
  /** Diagnostic reason (for logs/tests). */
  reason: string;
  winnerCount: number;
  loserCount: number;
}

function groupByRank(hand: Card[]): Map<string, Card[]> {
  const groups = new Map<string, Card[]>();
  for (const c of hand) {
    const arr = groups.get(c.rank) ?? [];
    arr.push(c);
    groups.set(c.rank, arr);
  }
  return groups;
}

/**
 * Count "winner units" — resources that take a trick or close out a round.
 *
 *   - Each 2 single                (each is virtually unbeatable as a single)
 *   - A-pair (one unit)            (unbeatable as a pair except by 2-pair)
 *   - Each distinct bomb (one unit per bomb rank)
 *   - 4,4,A special bomb (one unit, only if 4s aren't already counted as a bomb)
 *   - Red10×2 (one unit, only if 10s aren't already counted as a bomb)
 *
 * The intent is "how many tricks I'm structurally going to win", not "how
 * many high cards I have". A-pair counts as one event, not two, because it
 * fires once.
 */
export function countWinners(hand: Card[]): number {
  const groups = groupByRank(hand);
  let count = 0;

  // Each 2 single is a winner unit.
  count += groups.get('2')?.length ?? 0;

  // A-pair counts as one winner. 3+ aces is a bomb instead (counted below).
  const aces = groups.get('A')?.length ?? 0;
  if (aces === 2) count += 1;

  // Each distinct bomb rank = 1 winner unit. Skip rank '2' (already counted
  // as singles) — a 3-bomb of 2s would over-count, but the singles count is
  // closer to truth (each 2 is independently a power card).
  for (const [rank, cards] of groups) {
    if (rank === '2') continue;
    if (cards.length >= 3) count += 1;
  }

  // High pairs (Q-pair, K-pair). Held up against most pair-format plays —
  // only A-pair / 2-pair / bomb beat them, all rare in mid-game. A-pair is
  // counted above; 2-pair credit comes from the 2-singles count.
  for (const [rank, cards] of groups) {
    if (cards.length !== 2) continue;
    if (rank === 'A' || rank === '2') continue;
    const rv = RANK_ORDER[rank as keyof typeof RANK_ORDER];
    if (rv >= 9) count += 1; // Q (rv 9) or K (rv 10)
  }

  // Special bomb 4,4,A. Only count if neither 4s nor As are already a normal bomb.
  const fours = groups.get('4')?.length ?? 0;
  const fourIsBomb = fours >= 3;
  const aceIsBomb = aces >= 3;
  if (fours >= 2 && aces >= 1 && !fourIsBomb && !aceIsBomb) count += 1;

  // Red10×2: 2 red 10s, only if 10s aren't a regular bomb already.
  const redTens = hand.filter(c => c.rank === '10' && c.isRed).length;
  const tensIsBomb = (groups.get('10')?.length ?? 0) >= 3;
  if (redTens >= 2 && !tensIsBomb) count += 1;

  return count;
}

/**
 * Count "loser singletons" — single low cards (rank 3-7) with no pair/bomb
 * support. These need someone-smaller to play before we can shed them; if the
 * round leader is high and we can't beat, they sit in our hand.
 *
 * RANK_ORDER is 0-indexed (3=0, 7=4), so rv ∈ [0,4] = {3,4,5,6,7}. We exclude
 * 8 because it's mid-tier and often playable as a top-of-singles-chain.
 */
export function countLosers(hand: Card[]): number {
  const groups = groupByRank(hand);
  let count = 0;
  for (const [rank, cards] of groups) {
    const rv = RANK_ORDER[rank as keyof typeof RANK_ORDER];
    if (cards.length === 1 && rv >= 0 && rv <= 4) count++;
  }
  return count;
}

/**
 * Assess whether the bot should be in defensive (conserve, race-not-last) or
 * aggressive (race-to-exit) mode for the current decision.
 *
 * Triggers:
 *   - Aggressive override: ≤ 1 opponent still has >3 cards (everyone else is
 *     near exit). At this point we want to beat the last hold-out to exit.
 *   - Defensive (teammate-rescue): a known teammate has ≤ 2 cards. Let them
 *     win; don't compete with our own team.
 *   - Defensive (losing race): an opponent is at ≤ 2 cards AND our hand is ≥ 6
 *     AND we have < 2 winner units. We can't win this race; conserve.
 *   - Otherwise aggressive (default — existing P-rule behavior).
 */
export function assessRaceMode(
  myHand: Card[],
  myPlayer: Pick<PlayerState, 'id' | 'team'>,
  allPlayers: Pick<PlayerState, 'id' | 'isOut' | 'handSize' | 'team'>[],
): RaceAssessment {
  const handSize = myHand.length;
  const winnerCount = countWinners(myHand);
  const loserCount = countLosers(myHand);

  // Treat null-team players as opponents (pre-reveal we don't know partners).
  const opponents = allPlayers.filter(
    p => !p.isOut && p.id !== myPlayer.id && p.team !== myPlayer.team,
  );
  const teammates = allPlayers.filter(
    p => !p.isOut && p.id !== myPlayer.id && p.team === myPlayer.team && myPlayer.team !== null,
  );

  // 1. Aggressive override: only one opponent still racing.
  // "Active" = >3 cards. Anyone at ≤3 is essentially in the exit zone.
  const activeOpponents = opponents.filter(p => p.handSize > 3);
  if (activeOpponents.length <= 1) {
    return {
      mode: 'aggressive',
      reason: `last_opponent: ${activeOpponents.length} active opps with >3 cards`,
      winnerCount,
      loserCount,
    };
  }

  // 2. Teammate-rescue: known teammate is about to exit; let them.
  const teammateNearExit = teammates.some(p => p.handSize <= 2);
  if (teammateNearExit) {
    return {
      mode: 'defensive',
      reason: 'teammate_about_to_exit',
      winnerCount,
      loserCount,
    };
  }

  // 3. Losing race: opp close to out, big hand, weak winners.
  const opponentMinHand = opponents.length > 0
    ? Math.min(...opponents.map(p => p.handSize))
    : 99;
  if (opponentMinHand <= 2 && handSize >= 6 && winnerCount < 2) {
    return {
      mode: 'defensive',
      reason: `losing_race: opp_min=${opponentMinHand}, my_size=${handSize}, winners=${winnerCount}`,
      winnerCount,
      loserCount,
    };
  }

  return {
    mode: 'aggressive',
    reason: `default: opp_min=${opponentMinHand}, my_size=${handSize}, winners=${winnerCount}, losers=${loserCount}`,
    winnerCount,
    loserCount,
  };
}
