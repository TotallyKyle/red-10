import type { Card, Rank } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';

/**
 * Group cards by rank.
 * Useful for finding pairs, bombs, etc.
 */
export function groupByRank(cards: Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of cards) {
    const existing = groups.get(card.rank);
    if (existing) {
      existing.push(card);
    } else {
      groups.set(card.rank, [card]);
    }
  }
  return groups;
}

/**
 * Sort cards for display: by rank value ascending, then by suit.
 */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    // Secondary sort by suit name for stable ordering
    return a.suit.localeCompare(b.suit);
  });
}

/**
 * Find all possible straights of a given minimum length in a hand.
 * Returns arrays of cards forming valid straights.
 */
export function findPossibleStraights(cards: Card[], minLength: number): Card[][] {
  // Get unique ranks with their cards
  const rankGroups = groupByRank(cards);
  const uniqueRanks = [...rankGroups.keys()];

  // Sort ranks by value
  const sortedRanks = uniqueRanks.sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b]);

  const results: Card[][] = [];

  // Try all contiguous subsequences of sorted ranks
  for (let start = 0; start < sortedRanks.length; start++) {
    for (let end = start + minLength - 1; end < sortedRanks.length; end++) {
      const ranksSlice = sortedRanks.slice(start, end + 1);
      const values = ranksSlice.map((r) => RANK_ORDER[r]).sort((a, b) => a - b);

      // Check if consecutive
      let isConsecutive = true;
      for (let i = 1; i < values.length; i++) {
        if (values[i] !== values[i - 1] + 1) {
          isConsecutive = false;
          break;
        }
      }

      // Rule: 2 (value 12) cannot be at the top of a normal straight
      if (isConsecutive && values.includes(12)) {
        isConsecutive = false;
      }

      if (isConsecutive) {
        // Pick one card from each rank
        const straight = ranksSlice.map((rank) => rankGroups.get(rank)![0]);
        results.push(straight);
        continue;
      }

      // Check low-ace straight (A-2-3...)
      if (
        values.includes(11) && // A
        values.includes(12) && // 2
        values.includes(0) // 3
      ) {
        const remapped = values.map((v) => {
          if (v === 11) return -2;
          if (v === 12) return -1;
          return v;
        }).sort((a, b) => a - b);

        let isLowConsecutive = true;
        for (let i = 1; i < remapped.length; i++) {
          if (remapped[i] !== remapped[i - 1] + 1) {
            isLowConsecutive = false;
            break;
          }
        }

        if (isLowConsecutive) {
          const straight = ranksSlice.map((rank) => rankGroups.get(rank)![0]);
          results.push(straight);
        }
      }
    }
  }

  return results;
}
