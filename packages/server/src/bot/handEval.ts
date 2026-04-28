import type { Card } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';

// ---- Tunable weight constants ----
export interface HandEvalWeights {
  singleBase: number;
  singleLowPenalty: number;
  pairBase: number;
  pairLowPenalty: number;
  straightWeight: number;
  pairedStraightWeight: number;
  bombWeight: number;
}

export const DEFAULT_HAND_EVAL_WEIGHTS: HandEvalWeights = {
  singleBase: 1.0,
  singleLowPenalty: 0.6,
  pairBase: 1.0,
  pairLowPenalty: 0.3,
  straightWeight: 0.5,
  pairedStraightWeight: 0.4,
  bombWeight: 0.3,
};

// Rank index constants (RANK_ORDER: '3'=0, '4'=1, ..., 'A'=11, '2'=12)
const RANK_3 = 0;
const RANK_4 = 1;
const RANK_K = 10;
const RANK_A = 11;
const RANK_2 = 12;

// ---- Public API ----

export interface HandEval {
  /** Minimum number of plays (turns) needed to play the entire hand. */
  turns: number;
  /** Weighted cost — lower is "better" hand state. */
  score: number;
}

export function evaluateHand(hand: Card[], weights: HandEvalWeights = DEFAULT_HAND_EVAL_WEIGHTS): HandEval {
  const counts = new Array<number>(13).fill(0);
  for (const card of hand) {
    counts[RANK_ORDER[card.rank]]++;
  }
  const memo = new Map<string, HandEval>();
  return evaluate(counts, memo, weights);
}

// ---- Internal ----

function evaluate(counts: number[], memo: Map<string, HandEval>, w: HandEvalWeights): HandEval {
  const key = counts.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  if (counts.every(c => c === 0)) {
    const result: HandEval = { turns: 0, score: 0 };
    memo.set(key, result);
    return result;
  }

  let best: HandEval = { turns: Number.POSITIVE_INFINITY, score: Number.POSITIVE_INFINITY };

  const consider = (weight: number, next: number[]): void => {
    const sub = evaluate(next, memo, w);
    const turns = 1 + sub.turns;
    const score = weight + sub.score;
    if (score < best.score || (score === best.score && turns < best.turns)) {
      best = { turns, score };
    }
  };

  // Singles
  for (let r = 0; r < 13; r++) {
    if (counts[r] > 0) {
      const weight = w.singleBase + (w.singleLowPenalty * (12 - r)) / 12;
      const next = counts.slice();
      next[r] -= 1;
      consider(weight, next);
    }
  }

  // Pairs
  for (let r = 0; r < 13; r++) {
    if (counts[r] >= 2) {
      const weight = w.pairBase + (w.pairLowPenalty * (12 - r)) / 12;
      const next = counts.slice();
      next[r] -= 2;
      consider(weight, next);
    }
  }

  // Normal bombs (3+ same rank)
  for (let r = 0; r < 13; r++) {
    for (let k = 3; k <= counts[r]; k++) {
      const next = counts.slice();
      next[r] -= k;
      consider(w.bombWeight, next);
    }
  }

  // Special 4,4,A bomb (2 fours + N aces, N >= 1)
  if (counts[RANK_4] >= 2 && counts[RANK_A] >= 1) {
    for (let numAces = 1; numAces <= counts[RANK_A]; numAces++) {
      const next = counts.slice();
      next[RANK_4] -= 2;
      next[RANK_A] -= numAces;
      consider(w.bombWeight, next);
    }
  }

  // Normal straights (length >= 3, ranks 3..A; 2 cannot appear)
  for (let start = 0; start <= RANK_A - 2; start++) {
    if (counts[start] < 1) continue;
    for (let end = start + 1; end <= RANK_A; end++) {
      if (counts[end] < 1) break;
      if (end - start + 1 >= 3) {
        const next = counts.slice();
        for (let r = start; r <= end; r++) next[r] -= 1;
        consider(w.straightWeight, next);
      }
    }
  }

  // Low-ace straights: A + 2 + 3 + ... up to K (full 13-rank A-2-3-...-K is valid).
  if (counts[RANK_A] >= 1 && counts[RANK_2] >= 1 && counts[RANK_3] >= 1) {
    for (let topLow = RANK_3; topLow <= RANK_K; topLow++) {
      if (counts[topLow] < 1) break;
      const next = counts.slice();
      next[RANK_A] -= 1;
      next[RANK_2] -= 1;
      for (let r = RANK_3; r <= topLow; r++) next[r] -= 1;
      consider(w.straightWeight, next);
    }
  }

  // Paired straights — normal (length >= 3 ranks = 6+ cards, no rank 2)
  for (let start = 0; start <= RANK_A - 2; start++) {
    if (counts[start] < 2) continue;
    for (let end = start + 1; end <= RANK_A; end++) {
      if (counts[end] < 2) break;
      if (end - start + 1 >= 3) {
        const next = counts.slice();
        for (let r = start; r <= end; r++) next[r] -= 2;
        consider(w.pairedStraightWeight, next);
      }
    }
  }

  // Paired straights — low-ace variants (A,A,2,2,3,3 minimum, extending up to K).
  if (counts[RANK_A] >= 2 && counts[RANK_2] >= 2 && counts[RANK_3] >= 2) {
    for (let topLow = RANK_3; topLow <= RANK_K; topLow++) {
      if (counts[topLow] < 2) break;
      const next = counts.slice();
      next[RANK_A] -= 2;
      next[RANK_2] -= 2;
      for (let r = RANK_3; r <= topLow; r++) next[r] -= 2;
      consider(w.pairedStraightWeight, next);
    }
  }

  memo.set(key, best);
  return best;
}
