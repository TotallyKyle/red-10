import { RANK_ORDER, MIN_STRAIGHT_LENGTH } from './constants.js';
import type { Card, Rank, Play, PlayFormat, BombInfo, SpecialBombType } from './types.js';

// ---- Helpers ----

export function rankValue(rank: Rank): number {
  return RANK_ORDER[rank];
}

function allSameRank(cards: Card[]): boolean {
  return cards.every(c => c.rank === cards[0].rank);
}

function allDifferentRanks(cards: Card[]): boolean {
  const ranks = new Set(cards.map(c => c.rank));
  return ranks.size === cards.length;
}

function isConsecutiveArray(sorted: number[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

export function isRedTen(card: Card): boolean {
  return card.rank === '10' && card.isRed;
}

export function isBlackTen(card: Card): boolean {
  return card.rank === '10' && !card.isRed;
}

// ---- Straight validation ----

/**
 * Checks if the given cards form a valid straight.
 *
 * Rules:
 * - Minimum 3 cards, all different ranks
 * - A-2-3 is valid (A and 2 are low)
 * - Q-K-A is valid (A is high)
 * - K-A-2 is INVALID (no wrapping)
 * - 2 cannot be the high end of a big straight (only valid in A-2-3 low straights)
 */
export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < MIN_STRAIGHT_LENGTH) return false;
  if (!allDifferentRanks(cards)) return false;

  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);

  // Case 1: Normal consecutive (no 2 at the top)
  if (isConsecutiveArray(values)) {
    // 2 (value 12) can only appear in low straights (A-2-3), not at the top of a big straight.
    // In a normal consecutive sequence, if 2 is present it would be the highest value.
    // The only valid normal straight containing A (11) is one ending at A, like ...Q-K-A.
    // If 2 (12) is in a normal consecutive sequence, that means A (11) is also present,
    // making it ...K-A-2 which is a wrap — INVALID.
    if (values.includes(12)) return false;
    return true;
  }

  // Case 2: Low-ace straight (A-2-3, A-2-3-4, etc.)
  // A (11) and 2 (12) are remapped to be below 3 (0).
  const hasAce = values.includes(11);
  const hasTwo = values.includes(12);
  const hasThree = values.includes(0);

  if (hasAce && hasTwo && hasThree) {
    const remapped = values.map(v => {
      if (v === 11) return -2; // A goes below 2
      if (v === 12) return -1; // 2 goes below 3
      return v;
    }).sort((a, b) => a - b);
    return isConsecutiveArray(remapped);
  }

  return false;
}

/**
 * Gets the comparison value for a straight.
 * Higher value = stronger straight.
 * For low straights (A-2-3...), the value is based on the highest non-remapped card.
 */
export function straightValue(cards: Card[]): number {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);

  // Check if it's a low-ace straight
  const hasAce = values.includes(11);
  const hasTwo = values.includes(12);
  const hasThree = values.includes(0);

  if (hasAce && hasTwo && hasThree) {
    // Low straight: the "highest" card for comparison is the top of the remapped sequence
    const remapped = values.map(v => {
      if (v === 11) return -2;
      if (v === 12) return -1;
      return v;
    }).sort((a, b) => a - b);
    return remapped[remapped.length - 1];
  }

  // Normal straight: highest rank value
  return values[values.length - 1];
}

// ---- Paired straight validation ----

/**
 * Checks if the given cards form a valid paired straight (e.g., 3-3-4-4-5-5).
 *
 * Rules:
 * - Must have an even number of cards >= 6 (3 pairs minimum)
 * - Each rank appears exactly twice
 * - The ranks form a valid straight sequence
 */
export function isValidPairedStraight(cards: Card[]): boolean {
  if (cards.length < 6 || cards.length % 2 !== 0) return false;

  // Group by rank and ensure each rank has exactly 2
  const rankCounts = new Map<Rank, number>();
  for (const card of cards) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  }

  for (const count of rankCounts.values()) {
    if (count !== 2) return false;
  }

  // The unique ranks must form a valid straight
  const uniqueRanks = [...rankCounts.keys()];
  // Create virtual single-card array for straight check
  const virtualCards: Card[] = uniqueRanks.map(rank => ({
    id: `virtual-${rank}`,
    suit: 'hearts',
    rank,
    isRed: true,
  }));

  return isValidStraight(virtualCards);
}

/**
 * Gets the comparison value for a paired straight.
 */
export function pairedStraightValue(cards: Card[]): number {
  const uniqueRanks = [...new Set(cards.map(c => c.rank))];
  const virtualCards: Card[] = uniqueRanks.map(rank => ({
    id: `virtual-${rank}`,
    suit: 'hearts',
    rank,
    isRed: true,
  }));
  return straightValue(virtualCards);
}

// ---- Bomb classification ----

/**
 * Classifies a set of cards as a bomb, if valid.
 * Returns null if the cards don't form a valid bomb.
 *
 * Bomb types (in ascending power):
 * 1. Normal N-of-a-kind (3, 4, 5, or 6 of same rank)
 *    - Longer beats shorter regardless of rank
 *    - Same length: higher rank wins
 * 2. Pair of 4s + N aces (4,4,A / 4,4,A,A / etc.)
 *    - Highest bomb at its length tier
 * 3. 2 red 10s — tied for largest 5-card bomb
 * 4. 3 red 10s — largest bomb in the game, beats everything
 */
export function classifyBomb(cards: Card[]): BombInfo | null {
  // 3 red 10s: ultimate bomb
  if (
    cards.length === 3 &&
    cards.every(c => c.rank === '10' && c.isRed)
  ) {
    return { type: 'red10_3', length: 3, rankValue: Infinity };
  }

  // 2 red 10s: equivalent to largest 5-card bomb
  if (
    cards.length === 2 &&
    cards.every(c => c.rank === '10' && c.isRed)
  ) {
    return { type: 'red10_2', length: 2, rankValue: Infinity };
  }

  // Pair of 4s + aces
  const fours = cards.filter(c => c.rank === '4');
  const aces = cards.filter(c => c.rank === 'A');
  if (
    fours.length === 2 &&
    aces.length >= 1 &&
    fours.length + aces.length === cards.length
  ) {
    return { type: 'fours_aces', length: cards.length, rankValue: Infinity };
  }

  // Normal N-of-a-kind bomb
  if (cards.length >= 3 && allSameRank(cards)) {
    return { type: 'normal', length: cards.length, rankValue: rankValue(cards[0].rank) };
  }

  return null;
}

/**
 * Compares two bombs. Returns:
 *   positive if `a` beats `b`
 *   negative if `b` beats `a`
 *   0 if tied
 */
export function compareBombs(a: BombInfo, b: BombInfo): number {
  // 3 red 10s beats everything
  if (a.type === 'red10_3' && b.type === 'red10_3') return 0;
  if (a.type === 'red10_3') return 1;
  if (b.type === 'red10_3') return -1;

  // Effective length: 2 red 10s counts as 5-card tier
  const aLen = a.type === 'red10_2' ? 5 : a.length;
  const bLen = b.type === 'red10_2' ? 5 : b.length;

  // Longer bombs beat shorter
  if (aLen !== bLen) return aLen - bLen;

  // Same effective length: special bombs (fours_aces, red10_2) are highest at their tier
  const aIsSpecial = a.type === 'fours_aces' || a.type === 'red10_2';
  const bIsSpecial = b.type === 'fours_aces' || b.type === 'red10_2';

  if (aIsSpecial && bIsSpecial) return 0; // tied
  if (aIsSpecial) return 1;
  if (bIsSpecial) return -1;

  // Same length normal bombs: compare by rank
  return a.rankValue - b.rankValue;
}

// ---- Format detection ----

/**
 * Given a set of cards, determines what play format they represent.
 * Returns null if the cards don't form any valid play.
 *
 * Detection order matters: bombs are checked before straights because
 * 3+ of the same rank is a bomb, not a degenerate straight.
 */
export function detectFormat(cards: Card[]): PlayFormat | null {
  if (cards.length === 0) return null;

  if (cards.length === 1) return 'single';

  // Check bombs before pairs because 2 red 10s is a special bomb, not a pair.
  // Also check before straights since 3+ same rank = bomb, not a straight.
  if (classifyBomb(cards) !== null) return 'bomb';

  if (cards.length === 2 && allSameRank(cards)) return 'pair';

  // Check straight
  if (isValidStraight(cards)) return 'straight';

  // Check paired straight
  if (isValidPairedStraight(cards)) return 'paired_straight';

  return null;
}

// ---- Can-beat logic ----

/**
 * Gets the comparison value for a play (used for same-format comparison).
 */
export function getPlayValue(cards: Card[], format: PlayFormat): number {
  switch (format) {
    case 'single':
      return rankValue(cards[0].rank);
    case 'pair':
      return rankValue(cards[0].rank);
    case 'straight':
      return straightValue(cards);
    case 'paired_straight':
      return pairedStraightValue(cards);
    case 'bomb':
      // Bombs use their own comparison via compareBombs
      return 0;
    default:
      return 0;
  }
}

/**
 * Determines if `newCards` can beat `currentPlay` given the round's format.
 *
 * Rules:
 * - Bombs can be played on any format and beat non-bombs
 * - A bomb can only be beaten by a larger bomb
 * - Non-bomb plays must match the current format AND length, with a higher rank
 */
export function canBeat(newCards: Card[], currentPlay: Play): boolean {
  const newFormat = detectFormat(newCards);
  if (newFormat === null) return false;

  const currentFormat = currentPlay.format;

  // New play is a bomb
  if (newFormat === 'bomb') {
    const newBomb = classifyBomb(newCards)!;

    if (currentFormat === 'bomb') {
      // Bomb vs bomb: must be strictly larger
      const currentBomb = classifyBomb(currentPlay.cards)!;
      return compareBombs(newBomb, currentBomb) > 0;
    }

    // Bomb beats any non-bomb
    return true;
  }

  // Non-bomb: must match format and length
  if (newFormat !== currentFormat) return false;
  if (newCards.length !== currentPlay.cards.length) return false;

  // Compare by play value (higher wins)
  const newValue = getPlayValue(newCards, newFormat);
  const currentValue = getPlayValue(currentPlay.cards, currentFormat);
  return newValue > currentValue;
}

// ---- Defuse validation ----

/**
 * Checks if the given defuse cards can defuse the given bomb.
 * Only red 10 special bombs can be defused, using the corresponding number of black 10s.
 *
 * - 2 black 10s defuse 2 red 10s → round continues as pairs
 * - 3 black 10s defuse 3 red 10s → round continues as a 3-of-a-kind bomb
 */
export function isValidDefuse(defuseCards: Card[], bombInfo: BombInfo): boolean {
  if (bombInfo.type === 'red10_2') {
    return (
      defuseCards.length === 2 &&
      defuseCards.every(c => isBlackTen(c))
    );
  }

  if (bombInfo.type === 'red10_3') {
    return (
      defuseCards.length === 3 &&
      defuseCards.every(c => isBlackTen(c))
    );
  }

  return false;
}

/**
 * After a defuse, what format does the round continue as?
 */
export function defuseResultFormat(bombType: SpecialBombType): PlayFormat {
  switch (bombType) {
    case 'red10_2':
      return 'pair'; // 2 black 10s = a pair of 10s
    case 'red10_3':
      return 'bomb'; // 3 black 10s = a 3-of-a-kind bomb of 10s
    default:
      return 'bomb';
  }
}
