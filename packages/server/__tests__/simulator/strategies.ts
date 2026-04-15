import type { GameEngine } from '../../src/game/GameEngine.js';
import type { Card, Play, Rank } from '@red10/shared';
import { detectFormat, canBeat, classifyBomb, isBlackTen } from '@red10/shared';
import { RANK_ORDER, MIN_STRAIGHT_LENGTH, ALL_RANKS } from '@red10/shared';

// ---- Strategy Interface ----

export interface PlayerStrategy {
  name: string;

  decideDoubling(engine: GameEngine, playerId: string):
    | { action: 'double'; bombCards?: Card[] }
    | { action: 'skip' }
    | { action: 'quadruple' }
    | { action: 'skip_quadruple' };

  decidePlay(engine: GameEngine, playerId: string):
    | { action: 'play'; cards: Card[] }
    | { action: 'pass' }
    | { action: 'cha'; cards: Card[] }
    | { action: 'go_cha'; cards: Card[] }
    | { action: 'decline_cha' }
    | { action: 'defuse'; cards: Card[] };
}

// ---- Helper Functions ----

function rankValue(rank: string): number {
  return RANK_ORDER[rank];
}

/** Group hand cards by rank */
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
 * Get the set of ranks that form bombs in this hand (3+ of same rank).
 * These ranks should be preserved — don't break them into singles/pairs.
 */
export function getBombRanks(hand: Card[]): Set<string> {
  const groups = groupByRank(hand);
  const bombRanks = new Set<string>();
  for (const [rank, cards] of groups) {
    if (cards.length >= 3) bombRanks.add(rank);
  }
  // Also protect pairs of 4s if we have aces (fours+aces bomb)
  const fours = groups.get('4');
  const aces = groups.get('A');
  if (fours && fours.length >= 2 && aces && aces.length >= 1) {
    bombRanks.add('4');
    bombRanks.add('A');
  }
  return bombRanks;
}

/** Find all valid single cards that can beat the current play */
export function findValidSingles(hand: Card[], lastPlay: Play | null, preserveBombs = false): Card[][] {
  const bombRanks = preserveBombs ? getBombRanks(hand) : new Set<string>();
  const candidates = preserveBombs ? hand.filter(c => !bombRanks.has(c.rank)) : hand;

  if (lastPlay === null) {
    const results = candidates.map(c => [c]);
    // If preserving bombs left us with nothing, fall back to all cards
    return results.length > 0 ? results : hand.map(c => [c]);
  }
  const results: Card[][] = [];
  for (const c of candidates) {
    if (canBeat([c], lastPlay)) {
      results.push([c]);
    }
  }
  // Fallback: if we filtered out everything, try without preservation
  if (results.length === 0 && preserveBombs) {
    return findValidSingles(hand, lastPlay, false);
  }
  return results;
}

/** Find all valid pairs that can beat the current play */
export function findValidPairs(hand: Card[], lastPlay: Play | null, preserveBombs = false): Card[][] {
  const groups = groupByRank(hand);
  const bombRanks = preserveBombs ? getBombRanks(hand) : new Set<string>();
  const results: Card[][] = [];
  for (const [rank, cards] of groups) {
    // Skip bomb ranks to preserve them (unless they have more than 3, in which case
    // we can spare a pair and still keep a 3-card bomb)
    if (preserveBombs && bombRanks.has(rank) && cards.length < 5) continue;

    if (cards.length >= 2) {
      const pair = [cards[0], cards[1]];
      if (lastPlay === null || canBeat(pair, lastPlay)) {
        results.push(pair);
      }
    }
  }
  // Fallback
  if (results.length === 0 && preserveBombs) {
    return findValidPairs(hand, lastPlay, false);
  }
  return results;
}

/** Find all valid straights (min length 3) that can beat the current play */
export function findValidStraights(hand: Card[], lastPlay: Play | null): Card[][] {
  const groups = groupByRank(hand);
  const sortedRanks = [...groups.keys()].sort((a, b) => rankValue(a) - rankValue(b));

  const results: Card[][] = [];
  const targetLen = lastPlay?.length ?? MIN_STRAIGHT_LENGTH;

  // Try building straights of the required length
  for (let startIdx = 0; startIdx <= sortedRanks.length - targetLen; startIdx++) {
    const candidate: Card[] = [];
    for (let len = 0; len < targetLen && startIdx + len < sortedRanks.length; len++) {
      const rank = sortedRanks[startIdx + len];
      candidate.push(groups.get(rank)![0]);
    }
    if (candidate.length === targetLen) {
      const fmt = detectFormat(candidate);
      if (fmt === 'straight') {
        if (lastPlay === null || canBeat(candidate, lastPlay)) {
          results.push(candidate);
        }
      }
    }
  }

  // Handle A-2-3 low straights: if we have A, 2, and 3
  if (targetLen >= 3) {
    const hasA = groups.has('A');
    const has2 = groups.has('2');
    const has3 = groups.has('3');
    if (hasA && has2 && has3) {
      // Build the low straight starting from A
      const lowCards: Card[] = [groups.get('A')![0], groups.get('2')![0], groups.get('3')![0]];
      // Extend if needed
      const lowRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      for (let i = 3; i < targetLen && i < lowRanks.length; i++) {
        const rank = lowRanks[i];
        if (groups.has(rank)) {
          lowCards.push(groups.get(rank)![0]);
        } else {
          break;
        }
      }
      if (lowCards.length === targetLen) {
        const fmt = detectFormat(lowCards);
        if (fmt === 'straight' && (lastPlay === null || canBeat(lowCards, lastPlay))) {
          // Avoid duplicates
          const ids = new Set(lowCards.map(c => c.id));
          if (!results.some(r => r.every(c => ids.has(c.id)))) {
            results.push(lowCards);
          }
        }
      }
    }
  }

  return results;
}

/** Find all valid paired straights that can beat the current play */
export function findValidPairedStraights(hand: Card[], lastPlay: Play | null): Card[][] {
  const groups = groupByRank(hand);
  // Only ranks with 2+ cards can participate
  const pairableRanks = [...groups.entries()]
    .filter(([, cards]) => cards.length >= 2)
    .sort((a, b) => rankValue(a[0]) - rankValue(b[0]));

  const results: Card[][] = [];
  const targetPairs = lastPlay ? lastPlay.length / 2 : 3; // minimum 3 pairs

  for (let startIdx = 0; startIdx <= pairableRanks.length - targetPairs; startIdx++) {
    const candidate: Card[] = [];
    for (let len = 0; len < targetPairs && startIdx + len < pairableRanks.length; len++) {
      const cards = pairableRanks[startIdx + len][1];
      candidate.push(cards[0], cards[1]);
    }
    if (candidate.length === targetPairs * 2) {
      const fmt = detectFormat(candidate);
      if (fmt === 'paired_straight') {
        if (lastPlay === null || canBeat(candidate, lastPlay)) {
          results.push(candidate);
        }
      }
    }
  }

  return results;
}

/** Find all bombs in hand */
export function findBombs(hand: Card[]): Card[][] {
  const results: Card[][] = [];
  const groups = groupByRank(hand);

  // Normal N-of-a-kind bombs (3+)
  for (const [, cards] of groups) {
    if (cards.length >= 3) {
      // Add the full set as a bomb
      results.push([...cards]);
      // Also add sub-bombs for flexibility (e.g., 4 of a kind when you have 5)
      if (cards.length > 3) {
        // Just add the 3-card version too
        results.push(cards.slice(0, 3));
      }
    }
  }

  // Red 10 bombs
  const red10s = hand.filter(c => c.rank === '10' && c.isRed);
  if (red10s.length >= 2) {
    results.push(red10s.slice(0, 2));
  }
  if (red10s.length >= 3) {
    results.push(red10s.slice(0, 3));
  }

  // 4s + Aces bomb
  const fours = hand.filter(c => c.rank === '4');
  const aces = hand.filter(c => c.rank === 'A');
  if (fours.length >= 2 && aces.length >= 1) {
    const bombCards = [fours[0], fours[1], ...aces.slice(0, Math.min(aces.length, 4))];
    if (classifyBomb(bombCards)) {
      results.push(bombCards);
    }
  }

  return results;
}

/** Find valid opening plays (any format) */
export function findOpeningPlays(hand: Card[]): Card[][] {
  const results: Card[][] = [];

  // Singles
  for (const c of hand) {
    results.push([c]);
  }

  // Pairs
  const groups = groupByRank(hand);
  for (const [, cards] of groups) {
    if (cards.length >= 2) {
      results.push([cards[0], cards[1]]);
    }
  }

  // Straights
  const straights = findValidStraights(hand, null);
  results.push(...straights);

  // Paired straights
  const pairedStraights = findValidPairedStraights(hand, null);
  results.push(...pairedStraights);

  // Bombs
  const bombs = findBombs(hand);
  results.push(...bombs);

  return results;
}

/** Find all plays that can beat the current play.
 * If preserveBombs is true, avoid breaking apart bomb ranks for singles/pairs.
 */
function findBeatingPlays(hand: Card[], lastPlay: Play, preserveBombs = false): Card[][] {
  const results: Card[][] = [];
  const format = lastPlay.format;

  if (format === 'single') {
    results.push(...findValidSingles(hand, lastPlay, preserveBombs));
  } else if (format === 'pair') {
    results.push(...findValidPairs(hand, lastPlay, preserveBombs));
  } else if (format === 'straight') {
    results.push(...findValidStraights(hand, lastPlay));
  } else if (format === 'paired_straight') {
    results.push(...findValidPairedStraights(hand, lastPlay));
  } else if (format === 'bomb') {
    // Only bigger bombs can beat a bomb
    const currentBomb = classifyBomb(lastPlay.cards);
    if (currentBomb) {
      const allBombs = findBombs(hand);
      for (const bomb of allBombs) {
        if (canBeat(bomb, lastPlay)) {
          results.push(bomb);
        }
      }
    }
    return results;
  }

  // Can always play a bomb on a non-bomb format
  if (format !== 'bomb') {
    const bombs = findBombs(hand);
    results.push(...bombs);
  }

  return results;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Strategy Implementations ----

export const RandomStrategy: PlayerStrategy = {
  name: 'Random',

  decideDoubling(_engine: GameEngine, _playerId: string) {
    return { action: 'skip' as const };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    // Handle cha-go states
    if (validActions.includes('go_cha')) {
      if (Math.random() < 0.5 && round?.chaGoState) {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 3) {
          return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
        }
      }
    }

    if (validActions.includes('cha')) {
      if (Math.random() < 0.5 && round?.chaGoState) {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 2) {
          return { action: 'cha', cards: triggerCards.slice(0, 2) };
        }
      }
    }

    if (validActions.includes('decline_cha')) {
      return { action: 'decline_cha' };
    }

    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      if (Math.random() < 0.3) {
        const neededCount = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
        const blackTens = player.hand.filter(c => isBlackTen(c));
        if (blackTens.length >= neededCount) {
          return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
        }
      }
    }

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // If leader (must play)
    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const openingPlays = findOpeningPlays(player.hand);
      if (openingPlays.length > 0) {
        return { action: 'play', cards: pickRandom(openingPlays) };
      }
      // Fallback: play a single card
      return { action: 'play', cards: [player.hand[0]] };
    }

    // Following
    if (round?.lastPlay) {
      // During waiting_go, play single of trigger rank
      if (round.chaGoState?.phase === 'waiting_go') {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 1) {
          if (Math.random() < 0.5) {
            return { action: 'play', cards: [triggerCards[0]] };
          }
        }
        return { action: 'pass' };
      }

      if (Math.random() < 0.5) {
        const beatingPlays = findBeatingPlays(player.hand, round.lastPlay);
        if (beatingPlays.length > 0) {
          return { action: 'play', cards: pickRandom(beatingPlays) };
        }
      }
      if (validActions.includes('pass')) return { action: 'pass' };
    }

    // Fallback for opening play (no lastPlay)
    if (round && round.currentFormat === null) {
      const openingPlays = findOpeningPlays(player.hand);
      if (openingPlays.length > 0) {
        return { action: 'play', cards: pickRandom(openingPlays) };
      }
    }

    return { action: 'pass' };
  },
};

export const AggressiveStrategy: PlayerStrategy = {
  name: 'Aggressive',

  decideDoubling(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);

    if (validActions.includes('quadruple')) {
      return { action: 'quadruple' };
    }

    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (bombs.length > 0) {
        return { action: 'double', bombCards: bombs[0] };
      }
      // Red 10 team doesn't need bombCards
      if (player.team === 'red10') {
        return { action: 'double' };
      }
    }

    return { action: 'skip' };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    // Always go-cha if possible
    if (validActions.includes('go_cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 3) {
        return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
      }
    }

    // Cha: only if it doesn't break a bomb (3+ of trigger rank = bomb, don't cha with 2)
    if (validActions.includes('cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      // Only cha if we have 4+ (preserving at least a 2-card leftover) or exactly 2 (no bomb to break)
      if (triggerCards.length === 2 || triggerCards.length >= 4) {
        return { action: 'cha', cards: triggerCards.slice(0, 2) };
      }
      // If we have exactly 3, cha would break our bomb — decline
    }

    if (validActions.includes('decline_cha')) {
      return { action: 'decline_cha' };
    }

    // Defuse red 10 bombs when possible
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const neededCount = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const blackTens = player.hand.filter(c => isBlackTen(c));
      if (blackTens.length >= neededCount) {
        return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
      }
    }

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // Leader must play — prefer non-bomb cards
    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const bombRanks = getBombRanks(player.hand);
      const nonBombCards = player.hand.filter(c => !bombRanks.has(c.rank));

      if (nonBombCards.length > 0) {
        // Play lowest non-bomb single
        nonBombCards.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        return { action: 'play', cards: [nonBombCards[0]] };
      }
      // All cards are bomb material — play lowest single anyway
      const sorted = [...player.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
      return { action: 'play', cards: [sorted[0]] };
    }

    // Following: always play if possible, play lowest valid, preserve bombs
    if (round?.lastPlay) {
      // During waiting_go
      if (round.chaGoState?.phase === 'waiting_go') {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 1) {
          return { action: 'play', cards: [triggerCards[0]] };
        }
        return { action: 'pass' };
      }

      const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
      if (beatingPlays.length > 0) {
        // Play the lowest valid combo (save high cards)
        beatingPlays.sort((a, b) => {
          const aVal = Math.min(...a.map(c => rankValue(c.rank)));
          const bVal = Math.min(...b.map(c => rankValue(c.rank)));
          return aVal - bVal;
        });
        return { action: 'play', cards: beatingPlays[0] };
      }
    }

    if (round && round.currentFormat === null) {
      const openingPlays = findOpeningPlays(player.hand);
      if (openingPlays.length > 0) {
        openingPlays.sort((a, b) => {
          const aVal = Math.min(...a.map(c => rankValue(c.rank)));
          const bVal = Math.min(...b.map(c => rankValue(c.rank)));
          return aVal - bVal;
        });
        return { action: 'play', cards: openingPlays[0] };
      }
    }

    return { action: 'pass' };
  },
};

export const BomberStrategy: PlayerStrategy = {
  name: 'Bomber',

  decideDoubling(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);

    if (validActions.includes('quadruple')) {
      return { action: 'quadruple' };
    }

    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (bombs.length > 0) {
        return { action: 'double', bombCards: bombs[0] };
      }
      if (player.team === 'red10') {
        return { action: 'double' };
      }
    }

    return { action: 'skip' };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    if (validActions.includes('go_cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 3) {
        return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
      }
    }

    // Bomber: NEVER cha if it would break a bomb (3+ of that rank)
    if (validActions.includes('cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      // Only cha if we have exactly 2 (no bomb) or 5+ (can spare a pair and keep a bomb)
      if (triggerCards.length === 2 || triggerCards.length >= 5) {
        return { action: 'cha', cards: triggerCards.slice(0, 2) };
      }
      // Otherwise decline — protect the bomb
    }

    if (validActions.includes('decline_cha')) {
      return { action: 'decline_cha' };
    }

    // Always defuse red 10 bombs
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const neededCount = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const blackTens = player.hand.filter(c => isBlackTen(c));
      if (blackTens.length >= neededCount) {
        return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
      }
    }

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    if (round && round.currentFormat === null && round.leaderId === playerId) {
      // Opening: play singles/pairs of non-bomb ranks, preserve bomb ranks
      const groups = groupByRank(player.hand);
      const bombRanks = new Set<string>();
      for (const [rank, cards] of groups) {
        if (cards.length >= 3) bombRanks.add(rank);
      }

      // Play a single of a non-bomb rank
      const nonBombSingles = player.hand.filter(c => !bombRanks.has(c.rank));
      if (nonBombSingles.length > 0) {
        nonBombSingles.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        return { action: 'play', cards: [nonBombSingles[0]] };
      }

      // All cards are bomb ranks — play a single from the smallest bomb
      const sortedBombs = [...groups.entries()]
        .filter(([, cards]) => cards.length >= 3)
        .sort((a, b) => rankValue(a[0]) - rankValue(b[0]));
      if (sortedBombs.length > 0) {
        return { action: 'play', cards: [sortedBombs[0][1][0]] };
      }

      return { action: 'play', cards: [player.hand[0]] };
    }

    // Following: play bombs on high cards, otherwise play lowest non-bomb card
    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 1) {
          return { action: 'play', cards: [triggerCards[0]] };
        }
        return { action: 'pass' };
      }

      // If someone played a high card (rank >= K), play a bomb
      if (round.lastPlay.rankValue >= rankValue('K') && round.lastPlay.format !== 'bomb') {
        const bombs = findBombs(player.hand);
        const validBombs = bombs.filter(b => canBeat(b, round.lastPlay!));
        if (validBombs.length > 0) {
          return { action: 'play', cards: validBombs[0] };
        }
      }

      const beatingPlays = findBeatingPlays(player.hand, round.lastPlay);
      // Filter out bombs unless needed
      const nonBombBeaters = beatingPlays.filter(p => !classifyBomb(p));
      if (nonBombBeaters.length > 0) {
        nonBombBeaters.sort((a, b) => {
          const aVal = Math.min(...a.map(c => rankValue(c.rank)));
          const bVal = Math.min(...b.map(c => rankValue(c.rank)));
          return aVal - bVal;
        });
        return { action: 'play', cards: nonBombBeaters[0] };
      }

      // Only bombs left as options
      if (beatingPlays.length > 0) {
        return { action: 'play', cards: beatingPlays[0] };
      }
    }

    if (round && round.currentFormat === null) {
      return { action: 'play', cards: [player.hand[0]] };
    }

    return { action: 'pass' };
  },
};

export const ChaGoHunterStrategy: PlayerStrategy = {
  name: 'ChaGoHunter',

  decideDoubling(_engine: GameEngine, _playerId: string) {
    return { action: 'skip' as const };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    // Always go-cha if possible
    if (validActions.includes('go_cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 3) {
        return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
      }
    }

    // ChaGoHunter: ALWAYS cha — intentionally breaks bombs to test cha-go paths
    if (validActions.includes('cha') && round?.chaGoState) {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 2) {
        return { action: 'cha', cards: triggerCards.slice(0, 2) };
      }
    }

    if (validActions.includes('decline_cha')) {
      return { action: 'decline_cha' };
    }

    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const neededCount = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const blackTens = player.hand.filter(c => isBlackTen(c));
      if (blackTens.length >= neededCount) {
        return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
      }
    }

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // Leader: play singles preferentially to trigger cha-go, but preserve bombs
    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const bombRanks = getBombRanks(player.hand);
      const nonBombCards = player.hand.filter(c => !bombRanks.has(c.rank));
      if (nonBombCards.length > 0) {
        nonBombCards.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        return { action: 'play', cards: [nonBombCards[0]] };
      }
      const sorted = [...player.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
      return { action: 'play', cards: [sorted[0]] };
    }

    // Following
    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 1) {
          return { action: 'play', cards: [triggerCards[0]] };
        }
        return { action: 'pass' };
      }

      // Try to play singles to trigger cha-go, but preserve bomb ranks
      if (round.lastPlay.format === 'single') {
        const singles = findValidSingles(player.hand, round.lastPlay, true);
        if (singles.length > 0) {
          singles.sort((a, b) => rankValue(a[0].rank) - rankValue(b[0].rank));
          return { action: 'play', cards: singles[0] };
        }
      }

      const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
      if (beatingPlays.length > 0) {
        beatingPlays.sort((a, b) => {
          const aVal = Math.min(...a.map(c => rankValue(c.rank)));
          const bVal = Math.min(...b.map(c => rankValue(c.rank)));
          return aVal - bVal;
        });
        return { action: 'play', cards: beatingPlays[0] };
      }
    }

    if (round && round.currentFormat === null) {
      const bombRanks = getBombRanks(player.hand);
      const nonBomb = player.hand.filter(c => !bombRanks.has(c.rank));
      if (nonBomb.length > 0) {
        nonBomb.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        return { action: 'play', cards: [nonBomb[0]] };
      }
      return { action: 'play', cards: [player.hand[0]] };
    }

    return { action: 'pass' };
  },
};
