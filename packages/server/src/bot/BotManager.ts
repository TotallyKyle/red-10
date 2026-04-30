import type { GameEngine } from '../game/GameEngine.js';
import type { Card, RoundInfo } from '@red10/shared';

// ---- Strategy Interface (mirrors simulator) ----

export interface PlayerStrategy {
  name: string;

  decideDoubling(engine: GameEngine, playerId: string):
    | { action: 'double'; bombCards?: Card[] }
    | { action: 'skip' }
    | { action: 'quadruple'; bombCards?: Card[] }
    | { action: 'skip_quadruple' };

  decidePlay(engine: GameEngine, playerId: string):
    | { action: 'play'; cards: Card[] }
    | { action: 'pass' }
    | { action: 'cha'; cards: Card[] }
    | { action: 'go_cha'; cards: Card[] }
    | { action: 'decline_cha' }
    | { action: 'defuse'; cards: Card[] };
}

/**
 * Behavior toggles for sim/A-B purposes. Default behavior (all flags
 * undefined/false) is the SHIPPING behavior. Each flag DISABLES one of the
 * recent strategy fixes so a legacy variant can be reconstructed for
 * head-to-head comparison. Production strategies should not pass any of these.
 */
export interface BotPlayOptions {
  /** If true, restore the pre-fix bomb-as-opener fallback at hand ≥ 6 (instead of ≥ 10). */
  disableBombPreservation?: boolean;
  /** If true, skip the 2v4 doubling penalty when player holds 2 red 10s. */
  disable2v4DoublingPenalty?: boolean;
  /** If true, allow P3 to bomb single leads even when not near-exit / must-block. */
  disableSingleBombGuard?: boolean;
  /** If true, P3 fires whenever opponentMinHand ≤ 2 regardless of whether the
   * dangerous opponent has already passed this round (pre-Fix-C behavior). */
  disableMustBlockPassedCheck?: boolean;
  /** If true, skip defensive-mode logic — bot always races aggressively even
   * when its hand is too weak to win the race (pre-Fix-D behavior). */
  disableDefensiveMode?: boolean;
}

// ---- Inline strategies (simplified versions of simulator strategies) ----
// We inline them to avoid importing from __tests__ in production code.

import { detectFormat, canBeat, classifyBomb, isBlackTen, RANK_ORDER } from '@red10/shared';
import { assessRaceMode } from './raceAssessment.js';

function rankValue(rank: string): number {
  return RANK_ORDER[rank];
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

function getBombRanks(hand: Card[]): Set<string> {
  const groups = groupByRank(hand);
  const bombRanks = new Set<string>();
  for (const [rank, cards] of groups) {
    if (cards.length >= 3) bombRanks.add(rank);
  }
  const fours = groups.get('4');
  const aces = groups.get('A');
  if (fours && fours.length >= 2 && aces && aces.length >= 1) {
    bombRanks.add('4');
    bombRanks.add('A');
  }
  return bombRanks;
}

function findBombs(hand: Card[]): Card[][] {
  const results: Card[][] = [];
  const groups = groupByRank(hand);

  for (const [, cards] of groups) {
    if (cards.length >= 3) {
      results.push([...cards]);
      if (cards.length > 3) results.push(cards.slice(0, 3));
    }
  }

  const red10s = hand.filter(c => c.rank === '10' && c.isRed);
  if (red10s.length >= 2) results.push(red10s.slice(0, 2));
  if (red10s.length >= 3) results.push(red10s.slice(0, 3));

  const fours = hand.filter(c => c.rank === '4');
  const aces = hand.filter(c => c.rank === 'A');
  if (fours.length >= 2 && aces.length >= 1) {
    const bombCards = [fours[0], fours[1], ...aces.slice(0, Math.min(aces.length, 4))];
    if (classifyBomb(bombCards)) results.push(bombCards);
  }

  return results;
}

function findValidSingles(hand: Card[], lastPlay: import('@red10/shared').Play | null, preserveBombs = false): Card[][] {
  const bombRanks = preserveBombs ? getBombRanks(hand) : new Set<string>();
  const candidates = preserveBombs ? hand.filter(c => !bombRanks.has(c.rank)) : hand;

  if (lastPlay === null) {
    const results = candidates.map(c => [c]);
    return results.length > 0 ? results : hand.map(c => [c]);
  }
  const results: Card[][] = [];
  for (const c of candidates) {
    if (canBeat([c], lastPlay)) results.push([c]);
  }
  if (results.length === 0 && preserveBombs) return findValidSingles(hand, lastPlay, false);
  return results;
}

function findValidPairs(hand: Card[], lastPlay: import('@red10/shared').Play | null, preserveBombs = false): Card[][] {
  const groups = groupByRank(hand);
  const bombRanks = preserveBombs ? getBombRanks(hand) : new Set<string>();
  const results: Card[][] = [];
  for (const [rank, cards] of groups) {
    if (preserveBombs && bombRanks.has(rank) && cards.length < 5) continue;
    if (cards.length >= 2) {
      const pair = [cards[0], cards[1]];
      if (lastPlay === null || canBeat(pair, lastPlay)) results.push(pair);
    }
  }
  return results;
}

function findValidStraights(hand: Card[], lastPlay: import('@red10/shared').Play | null): Card[][] {
  const groups = groupByRank(hand);
  const sortedRanks = [...groups.keys()].sort((a, b) => rankValue(a) - rankValue(b));
  const results: Card[][] = [];

  // When responding, must match exact length of the play to beat.
  // When opening, enumerate all straight lengths ≥ 3 so the bot can choose
  // a 5- or 7-card straight instead of being locked into 3-card windows.
  const lengths: number[] = lastPlay
    ? [lastPlay.length]
    : Array.from({ length: Math.max(0, sortedRanks.length - 2) }, (_, i) => i + 3);

  for (const targetLen of lengths) {
    for (let startIdx = 0; startIdx <= sortedRanks.length - targetLen; startIdx++) {
      const candidate: Card[] = [];
      for (let len = 0; len < targetLen; len++) {
        const rank = sortedRanks[startIdx + len];
        candidate.push(groups.get(rank)![0]);
      }
      if (candidate.length === targetLen) {
        const fmt = detectFormat(candidate);
        if (fmt === 'straight') {
          if (lastPlay === null || canBeat(candidate, lastPlay)) results.push(candidate);
        }
      }
    }
  }
  return results;
}

function findValidPairedStraights(hand: Card[], lastPlay: import('@red10/shared').Play | null): Card[][] {
  const groups = groupByRank(hand);
  const pairableRanks = [...groups.entries()]
    .filter(([, cards]) => cards.length >= 2)
    .sort((a, b) => rankValue(a[0]) - rankValue(b[0]));
  const results: Card[][] = [];

  // When responding, must match exact pair count; when opening, enumerate all
  // valid pair counts ≥ 2 so the bot can open with a 4- or 8-card paired_straight.
  const pairCounts: number[] = lastPlay
    ? [lastPlay.length / 2]
    : Array.from({ length: Math.max(0, pairableRanks.length - 1) }, (_, i) => i + 2);

  for (const targetPairs of pairCounts) {
    for (let startIdx = 0; startIdx <= pairableRanks.length - targetPairs; startIdx++) {
      const candidate: Card[] = [];
      for (let len = 0; len < targetPairs && startIdx + len < pairableRanks.length; len++) {
        const cards = pairableRanks[startIdx + len][1];
        candidate.push(cards[0], cards[1]);
      }
      if (candidate.length === targetPairs * 2) {
        const fmt = detectFormat(candidate);
        if (fmt === 'paired_straight') {
          if (lastPlay === null || canBeat(candidate, lastPlay)) results.push(candidate);
        }
      }
    }
  }
  return results;
}

export function findBeatingPlays(hand: Card[], lastPlay: import('@red10/shared').Play, preserveBombs = false): Card[][] {
  const results: Card[][] = [];
  const format = lastPlay.format;

  if (format === 'single') results.push(...findValidSingles(hand, lastPlay, preserveBombs));
  else if (format === 'pair') results.push(...findValidPairs(hand, lastPlay, preserveBombs));
  else if (format === 'straight') results.push(...findValidStraights(hand, lastPlay));
  else if (format === 'paired_straight') results.push(...findValidPairedStraights(hand, lastPlay));
  else if (format === 'bomb') {
    const allBombs = findBombs(hand);
    for (const bomb of allBombs) {
      if (canBeat(bomb, lastPlay)) results.push(bomb);
    }
    return results;
  }

  // After the else-if chain, format is not 'bomb' (that branch returns early),
  // so we can always add bombs as an option.
  results.push(...findBombs(hand));
  return results;
}

function sortByLowestRank(plays: Card[][]): Card[][] {
  return [...plays].sort((a, b) => {
    const aVal = Math.min(...a.map(c => rankValue(c.rank)));
    const bVal = Math.min(...b.map(c => rankValue(c.rank)));
    return aVal - bVal;
  });
}

// ---- Opening play scoring ----

/**
 * Identify cards that are "orphans" — not part of any straight, pair, or bomb.
 * These are dead weight that's hard to get rid of except by leading.
 */
function findOrphanCards(hand: Card[]): Set<string> {
  const usedInMulti = new Set<string>();
  const groups = groupByRank(hand);

  // Cards in pairs
  for (const [, cards] of groups) {
    if (cards.length >= 2) {
      for (const c of cards) usedInMulti.add(c.id);
    }
  }

  // Cards in straights
  const straights = findValidStraights(hand, null);
  for (const s of straights) {
    for (const c of s) usedInMulti.add(c.id);
  }

  // Cards in paired straights
  const ps = findValidPairedStraights(hand, null);
  for (const p of ps) {
    for (const c of p) usedInMulti.add(c.id);
  }

  // Cards in bombs
  const bombRanks = getBombRanks(hand);
  for (const c of hand) {
    if (bombRanks.has(c.rank)) usedInMulti.add(c.id);
  }

  return new Set(hand.filter(c => !usedInMulti.has(c.id)).map(c => c.id));
}

/**
 * Has `playerId` passed in the current round, since the most recent play?
 *
 * In Red 10, once a player passes in a round they cannot rejoin it. Between
 * the most recent player-to-play (`round.lastPlay.playerId`) and the next
 * player to act (`round.currentPlayerId`), every player in clockwise order
 * has passed in the current cycle (the engine moves currentPlayerId past
 * passers automatically). This helper checks if `playerId` is in that range.
 *
 * Returns false if no play has been made yet (round just started — nobody has
 * passed yet) or if `playerId` was the most recent player or is the current
 * player.
 */
function hasPassedThisRound(
  playerId: string,
  round: RoundInfo | null,
  players: { id: string; seatIndex: number }[],
): boolean {
  if (!round?.lastPlay) return false;
  const lastPlayerId = round.lastPlay.playerId;
  const currentPlayerId = round.currentPlayerId;
  if (playerId === lastPlayerId) return false;
  if (playerId === currentPlayerId) return false;

  const lastSeat = players.find(p => p.id === lastPlayerId)?.seatIndex;
  const currentSeat = players.find(p => p.id === currentPlayerId)?.seatIndex;
  const playerSeat = players.find(p => p.id === playerId)?.seatIndex;
  if (lastSeat === undefined || currentSeat === undefined || playerSeat === undefined) return false;

  // Walk clockwise from lastSeat+1 up to (but not including) currentSeat.
  // Any seat in that range has been passed-through in the current cycle.
  let seat = (lastSeat + 1) % 6;
  while (seat !== currentSeat) {
    if (seat === playerSeat) return true;
    seat = (seat + 1) % 6;
  }
  return false;
}

/**
 * Score an opening play. Higher = better opening.
 * Priorities:
 *   1. Plays that clear more cards (straights, paired straights)
 *   2. Plays that use low-value orphan cards (hard to play otherwise)
 *   3. Plays with lower ranks (save high cards for beating others)
 *   4. Avoid using cards that are part of bombs (preserve bombs for later)
 */
function scoreOpening(cards: Card[], hand: Card[]): number {
  let score = 0;
  const bombRanks = getBombRanks(hand);
  const orphans = findOrphanCards(hand);

  // Big bonus for playing many cards — clears hand fast
  score += cards.length * 10;

  const avgRank = cards.reduce((sum, c) => sum + rankValue(c.rank), 0) / cards.length;
  const isEndgame = hand.length <= 4;

  if (isEndgame) {
    // In endgame, prefer high-rank plays: they win rounds and accelerate exit.
    // "Save high cards for responding" doesn't apply when few cards remain.
    score += avgRank;
  } else {
    // Bonus for playing orphan cards (dead weight we can only shed by leading)
    const orphanCount = cards.filter(c => orphans.has(c.id)).length;
    score += orphanCount * 8;

    // Bonus for low rank (we want to save high cards for beating opponents)
    score += (12 - avgRank) * 2; // lower rank = higher score

    // Heavy penalty for leading with 2s or Aces — these are power cards
    // for RESPONDING, not leading. A 2 is nearly unbeatable so save it.
    const hasTwos = cards.some(c => c.rank === '2');
    const hasAces = cards.some(c => c.rank === 'A');
    if (hasTwos) score -= 20; // never lead with 2s in any format
    if (hasAces && !hasTwos) score -= 10; // avoid leading with Aces (unless part of 4,4,A)
  }

  // Penalty for using bomb cards (preserve bombs for interrupts)
  const bombCardCount = cards.filter(c => bombRanks.has(c.rank)).length;
  score -= bombCardCount * 5;

  // Bonus for straights and paired straights (harder to beat)
  const fmt = detectFormat(cards);
  if (fmt === 'straight') score += 5;
  if (fmt === 'paired_straight') score += 8;

  // Large-hand dump incentive: when stuck with ≥7 cards, prefer plays that shed
  // 2+ cards at once to reduce trap risk.
  if (hand.length >= 7 && cards.length >= 2) {
    score += 6;
  }

  // Full-hand exit: playing the entire hand clears the round in one shot.
  if (cards.length === hand.length && hand.length > 1) {
    score += 100;
  }

  return score;
}

/**
 * Choose the best opening play from all possible options.
 */
function chooseBestOpening(hand: Card[], opts: BotPlayOptions = {}): Card[] | null {
  const candidates: Card[][] = [];
  const bombRanks = getBombRanks(hand);

  // Collect all possible openings
  // Exclude straights that use bomb-rank cards (would destroy a bomb), same as pairs/singles.
  candidates.push(...findValidStraights(hand, null).filter(
    s => !s.some(c => bombRanks.has(c.rank)),
  ));
  candidates.push(...findValidPairedStraights(hand, null).filter(
    s => !s.some(c => bombRanks.has(c.rank)),
  ));

  // Pairs (preserving bombs)
  const groups = groupByRank(hand);
  for (const [rank, cards] of groups) {
    if (cards.length >= 2 && !(bombRanks.has(rank) && cards.length < 5)) {
      candidates.push([cards[0], cards[1]]);
    }
  }

  // Singles (preserving bombs)
  for (const c of hand) {
    if (!bombRanks.has(c.rank)) {
      candidates.push([c]);
    }
  }

  // Full-hand exit: if the entire hand is a valid format, add it as a candidate.
  // scoreOpening gives it +100 so it wins unless there's a reason not to play it.
  if (hand.length >= 2) {
    const fmt = detectFormat(hand);
    if (fmt) candidates.push([...hand]);
  }

  // Lone-single fallback: if only single-card candidates remain and the hand
  // is very large (≥10 cards) — bomb-as-opener is rarely worth the lost
  // resource; only use this fallback when truly stuck with no multi-card
  // non-bomb plays. For 6-9 card hands, prefer leading a low orphan single
  // and preserving the bomb for later defensive/exit use. The pre-fix
  // threshold of 6 can be restored via opts.disableBombPreservation for
  // legacy A/B testing.
  const loneFallbackMin = opts.disableBombPreservation ? 6 : 10;
  const allowRedTenTwoOpen = hand.length <= 4;
  if (candidates.length > 0 && candidates.every(c => c.length === 1) && hand.length >= loneFallbackMin) {
    candidates.push(...findBombs(hand).filter(b => allowRedTenTwoOpen || classifyBomb(b)?.type !== 'red10_2'));
  }

  // All-bomb-rank fallback: when all cards are bomb-rank (no safe opening exists), prefer
  // the weakest full bomb over a single card from a bomb group — a 3-card bomb
  // sheds more cards, wins the round more reliably, and breaks fewer distinct bombs.
  if (candidates.length === 0) {
    const bombs = findBombs(hand).filter(b => allowRedTenTwoOpen || classifyBomb(b)?.type !== 'red10_2');
    if (bombs.length > 0) {
      candidates.push(...bombs);
    } else {
      for (const c of hand) candidates.push([c]);
    }
  }

  if (candidates.length === 0) return null;

  // Score and pick the best
  let best = candidates[0];
  let bestScore = scoreOpening(best, hand);

  for (let i = 1; i < candidates.length; i++) {
    const s = scoreOpening(candidates[i], hand);
    if (s > bestScore) {
      bestScore = s;
      best = candidates[i];
    }
  }

  return best;
}

// ---- Shared helpers for smarter play ----

/**
 * Evaluate hand strength for doubling decisions. Returns a score 0-10.
 *
 * Doubling is a bet: you're claiming your team will win. A losing double
 * costs double the normal payout, so the bar needs to be HIGH. This function
 * only rewards genuinely strong structural features — not "any random
 * straight" which every hand has.
 *
 * Prior versions over-rewarded straights (counted overlapping ones) and
 * double-counted bombs (findBombs returns [...all] and [...slice(0,3)] for
 * 4+card bombs), causing aggressive bots to double on mediocre hands.
 */
function evaluateHandStrength(hand: Card[]): number {
  const groups = groupByRank(hand);
  let score = 0;

  // ---- Bombs (the primary reason to double) ----
  // Count DISTINCT bomb ranks (don't double-count 4+ card bombs).
  const bombRanks = new Set<string>();
  let hasFourPlusBomb = false;
  for (const [rank, cards] of groups) {
    if (cards.length >= 3) bombRanks.add(rank);
    if (cards.length >= 4) hasFourPlusBomb = true;
  }
  const fours = groups.get('4');
  const aces = groups.get('A');
  const hasSpecialBomb = !!(fours && fours.length >= 2 && aces && aces.length >= 1);

  // First bomb: 3 pts. Each additional bomb is +4 — multiple bombs is what
  // actually makes a hand bet-worthy. 2 bombs alone should cross the bar.
  if (bombRanks.size >= 1) score += 3;
  if (bombRanks.size >= 2) score += 4;
  if (bombRanks.size >= 3) score += 4;
  if (hasFourPlusBomb) score += 2;
  if (hasSpecialBomb) score += 3;

  // ---- Hand density (fewer distinct ranks = hand plays out fast) ----
  if (groups.size <= 4) score += 4;
  else if (groups.size <= 5) score += 2;

  // ---- Straights: only award one bonus for HAVING a long straight, not
  //      a point per overlapping straight window. Long straights are solid
  //      but not bet-worthy on their own. ----
  let maxStraightLen = 0;
  {
    const sortedRanks = [...groups.keys()].sort((a, b) => rankValue(a) - rankValue(b));
    let run = 0;
    let prev = -2;
    for (const r of sortedRanks) {
      const v = rankValue(r);
      if (v === prev + 1) {
        run++;
      } else {
        run = 1;
      }
      maxStraightLen = Math.max(maxStraightLen, run);
      prev = v;
    }
  }
  if (maxStraightLen >= 6) score += 1.5;
  else if (maxStraightLen >= 5) score += 1;

  // ---- High cards ----
  const twos = groups.get('2')?.length ?? 0;
  if (twos >= 3) score += 1;
  else if (twos >= 2) score += 0.5;

  return Math.min(score, 10);
}

/**
 * Check if the last play was made by a teammate.
 * If teams are not known, returns false (can't tell).
 */
function lastPlayByTeammate(engine: GameEngine, playerId: string): boolean {
  const state = engine.getState();
  const round = state.round;
  if (!round?.lastPlay) return false;

  const me = state.players.find(p => p.id === playerId);
  const lastPlayer = state.players.find(p => p.id === round.lastPlay!.playerId);
  if (!me || !lastPlayer) return false;

  // If teams aren't revealed yet, we can only know our own team
  // A teammate is someone on the same team as us, but we might not know their team
  if (!me.team || !lastPlayer.team) return false;

  // If teams are revealed (doubling happened, or red 10s played)
  if (me.team === lastPlayer.team) return true;

  return false;
}

/**
 * Standard doubling logic used by all strategies.
 *
 * Doubling without a strong hand is a bad bet — if you lose, you pay double.
 * Bots should double ONLY when the hand has clear structural strength:
 *   - Multiple bombs, OR
 *   - A bomb plus a very dense hand (≤4 distinct ranks), OR
 *   - Special bomb (fours + aces)
 *
 * Quadrupling requires even more (multiple bombs AND density).
 */
function standardDoublingDecision(
  engine: GameEngine,
  playerId: string,
  strengthThreshold: number,
  opts: BotPlayOptions = {},
): ReturnType<PlayerStrategy['decideDoubling']> {
  const state = engine.getState();
  const player = state.players.find(p => p.id === playerId)!;
  const validActions = engine.getValidActions(playerId);

  const strength = evaluateHandStrength(player.hand);

  // Count distinct bomb ranks (not all bomb-play variants).
  const groups = groupByRank(player.hand);
  const distinctBombRanks = [...groups.values()].filter(cs => cs.length >= 3).length;
  const fours = groups.get('4');
  const aces = groups.get('A');
  const hasSpecialBomb = !!(fours && fours.length >= 2 && aces && aces.length >= 1);

  // 2v4 detection: if this player holds 2 red 10s, the team must be 2v4
  // (only 1 other red 10 exists, held by exactly 1 other player). 2v4 is a
  // significant structural disadvantage — require much stronger hand before
  // doubling. Can be disabled for legacy A/B via opts.disable2v4DoublingPenalty.
  const redTensHeld = player.hand.filter(c => c.rank === '10' && c.isRed).length;
  const isKnown2v4 = redTensHeld === 2 && !opts.disable2v4DoublingPenalty;

  // +1 is the meaningful delta here: evaluateHandStrength caps at 10, so threshold+2
  // would be unreachable for any hand. +1 ensures a 2v4 player needs top-tier
  // strength (2 bombs + density) rather than merely borderline (1 bomb + density).
  const effectiveThreshold = isKnown2v4 ? strengthThreshold + 1 : strengthThreshold;
  const hasStrongStructure = isKnown2v4
    ? distinctBombRanks >= 2
    : distinctBombRanks >= 2 ||
      (distinctBombRanks >= 1 && groups.size <= 4) ||
      hasSpecialBomb;

  // Non-red10 players need a bomb to REVEAL when doubling/quadrupling.
  // Find the primary bomb to reveal (largest group).
  const bombsToReveal: Card[][] = [];
  for (const [, cards] of groups) {
    if (cards.length >= 3) bombsToReveal.push([...cards]);
  }
  if (hasSpecialBomb && fours && aces) {
    bombsToReveal.push([fours[0], fours[1], aces[0]]);
  }

  if (validActions.includes('quadruple')) {
    // Quadruple bar: need real power — two bombs OR a bomb + density.
    const strongEnoughToQuad =
      strength >= effectiveThreshold + 2 &&
      (distinctBombRanks >= 2 || hasSpecialBomb);
    if (strongEnoughToQuad) {
      if (player.team === 'red10') return { action: 'quadruple' };
      if (bombsToReveal.length > 0) return { action: 'quadruple', bombCards: bombsToReveal[0] };
    }
    return { action: 'skip_quadruple' };
  }

  if (validActions.includes('double')) {
    if (strength >= effectiveThreshold && hasStrongStructure) {
      if (player.team === 'red10') return { action: 'double' };
      if (bombsToReveal.length > 0) return { action: 'double', bombCards: bombsToReveal[0] };
    }
  }

  return { action: 'skip' };
}

/**
 * Estimate how many copies of a rank have been played already.
 * With 60% accuracy to simulate human-level card counting.
 * In a 1.5 deck game, there are 6 copies of each rank.
 */
function estimatePlayedCopies(rank: string, round: RoundInfo, myHand: Card[]): number {
  // Count exact copies we know about: in our hand + played in this round's history
  const inMyHand = myHand.filter(c => c.rank === rank).length;
  const playedInRound = round.plays
    .flatMap(p => p.cards)
    .filter(c => c.rank === rank).length;

  const knownPlayed = playedInRound;
  const totalKnown = inMyHand + knownPlayed;

  // We know for sure what's in our hand and what's been played this round.
  // For cards played in previous rounds, we "remember" with 60% accuracy.
  // Simulate this by adding noise: the actual count is exact, but we
  // randomly forget ~40% of previously seen cards.
  // For simplicity, just use what we can see + a fuzzy estimate.
  // Total copies = 6. Known = inMyHand + playedInRound.
  // Remaining in other hands = 6 - totalKnown (but we're fuzzy on this)

  // Apply 60% accuracy: sometimes we think there are more/fewer remaining
  if (Math.random() < 0.4) {
    // 40% chance we miscount by ±1
    const miscount = Math.random() < 0.5 ? 1 : -1;
    return Math.max(0, Math.min(6, totalKnown + miscount));
  }

  return totalKnown;
}

/**
 * Decide whether to cha based on turn order and card counting.
 *
 * Returns: 'cha' | 'go_cha' | 'decline'
 *
 * Strategy:
 * 1. Go-cha (3 of a kind) is always best — auto-win
 * 2. Cha is good if it SKIPS an opponent (interrupts their turn)
 * 3. Cha is BAD if a teammate is next and close to going out
 * 4. Cha is GREAT if card counting suggests no more copies remain (winning cha)
 * 5. Cha is RISKY if many copies remain (someone else gets the go + final cha)
 */
function decideChaGo(
  engine: GameEngine,
  playerId: string,
  triggerRank: string,
  matchingCards: Card[],
): 'cha' | 'go_cha' | 'decline' {
  const state = engine.getState();
  const player = state.players.find(p => p.id === playerId)!;
  const round = state.round!;
  const cg = round.chaGoState!;

  // Go-cha (3 cards) is an auto-win, but it's only LEGAL after a prior paired
  // cha. That means we can only go-cha in waiting_go (single-player's turn) or
  // waiting_final_cha. In waiting_cha we must do a paired cha first.
  if (matchingCards.length >= 3 && cg.phase !== 'waiting_cha') return 'go_cha';

  // Need at least 2 to cha
  if (matchingCards.length < 2) return 'decline';

  // HIGHEST PRIORITY: never steal a teammate's winning turn.
  // Check this BEFORE anything else — no card count or opponent skip justifies
  // blocking your own teammate from going out.
  const myIdx = state.players.findIndex(p => p.id === playerId);
  const lastPlayerId = round.lastPlay?.playerId;
  if (lastPlayerId) {
    const lastIdx = state.players.findIndex(p => p.id === lastPlayerId);
    // Find players between last player and me (clockwise) — these get skipped
    let checkIdx = (lastIdx + 1) % 6;
    while (checkIdx !== myIdx) {
      const p = state.players[checkIdx];
      if (!p.isOut && p.team === player.team && p.handSize <= 2) {
        return 'decline'; // teammate about to win — never steal their turn
      }
      checkIdx = (checkIdx + 1) % 6;
    }
  }

  // Card counting: estimate how many copies remain in other players' hands.
  // estimatePlayedCopies already sums the bot's own copies with copies played
  // this round, so subtracting it once from totalCopies gives the remainder in
  // other hands. A prior version subtracted `inMyHand` a second time, which
  // under the ±1 miscount noise occasionally read as 0 — making the bot
  // hallucinate a "winning cha" and burn power cards (e.g. 2s, aces).
  const totalCopies = 6; // 1.5 decks
  const estimatedKnown = estimatePlayedCopies(triggerRank, round, player.hand);
  const estimatedRemaining = totalCopies - estimatedKnown;

  // If we think no copies remain after our cha, we win the round!
  const afterChaRemaining = estimatedRemaining;
  if (afterChaRemaining <= 0) {
    return 'cha'; // high confidence winning cha
  }

  // RANK COST: high ranks are expensive to cha with because you burn power cards.
  // Also, 2s can't be "beaten" by singles anyway — playing a 2 single already
  // controls the round, so cha'ing 2s rarely adds value.
  //   2     → HIGH cost (only cha to skip a dangerous opponent or guaranteed win)
  //   A     → HIGH cost (same)
  //   K, Q  → MED cost (cha if skipping opponent who might go out)
  //   lower → LOW cost (current behavior)
  const rv = rankValue(triggerRank);
  const isHighRank = rv >= 11; // A or 2
  const isMedRank = rv === 10 || rv === 9; // K or Q

  // Compute triggerIsTeammate here so it's accessible after the if (lastPlayerId) block.
  const triggerPlayer = lastPlayerId ? state.players.find(p => p.id === lastPlayerId) : null;
  const triggerIsTeammate = !!(
    triggerPlayer?.team && player.team && triggerPlayer.team === player.team
  );

  // Turn order analysis: who would we skip by chaing?
  if (lastPlayerId) {
    const lastIdx2 = state.players.findIndex(p => p.id === lastPlayerId);

    // Players between lastPlayer and me (clockwise) — these get skipped by cha
    const skippedPlayers: typeof state.players = [];
    let checkIdx2 = (lastIdx2 + 1) % 6;
    while (checkIdx2 !== myIdx) {
      const p = state.players[checkIdx2];
      if (!p.isOut) skippedPlayers.push(p);
      checkIdx2 = (checkIdx2 + 1) % 6;
    }

    // Skip an opponent about to go out — highest-value reason to cha.
    // For HIGH ranks (A, 2): require ≤2 cards.
    // For LOW ranks with teammate trigger: tighten to ≤2 (normal is ≤3).
    // For LOW ranks without teammate trigger: ≤3 is fine.
    const criticalThreshold = isHighRank || (triggerIsTeammate && !isMedRank) ? 2 : 3;
    const criticalOpponentSkipped = skippedPlayers.some(
      p => p.team !== player.team && p.handSize <= criticalThreshold,
    );
    if (criticalOpponentSkipped) {
      return 'cha';
    }

    // Bomb-preservation gate: if cha would reduce a bomb-rank group below 3 cards
    // (i.e., we hold ×3 or ×4 of the trigger rank), playing a 2-card pair destroys
    // the bomb. Only the two critical reasons above justify that cost — decline here.
    if (matchingCards.length >= 3 && matchingCards.length - 2 < 3) {
      return 'decline';
    }

    // HIGH rank cutoff: for 2s and Aces, we stop here unless it's a clear skip.
    // No "skip any opponent" or "thin hand" justifies burning a power card.
    if (isHighRank) {
      return 'decline';
    }

    // MED rank: only cha if skipping an opponent with a below-average hand.
    if (isMedRank) {
      const midHandOpponentSkipped = skippedPlayers.some(
        p => p.team !== player.team && p.handSize <= 5,
      );
      if (midHandOpponentSkipped) return 'cha';
      return 'decline';
    }

    // LOW rank: don't unconditionally cha just because an opponent is in the skip
    // window. The go window is accessible to ALL players including those opponents'
    // teammates — CHA on a low-rank opponent trigger has repeatedly given the
    // opposing team free round wins via the go. Fall through to speculative section.
  }

  // No skip value. For high/med ranks, never cha speculatively.
  if (isHighRank || isMedRank) return 'decline';

  // Speculative cha paths are only valid when the trigger is NOT a teammate.
  // If the trigger is a teammate (e.g., they just played the go-single), cha-ing
  // over them steals their trick — always decline in that case.
  if (!triggerIsTeammate) {
    // Hand-shaping: if we hold a 5+ card straight that the cha pair won't break
    // AND we're already near-exit, cha to thin the hand toward that straight.
    // The hand-size gate matters: at 13 cards a 5-card straight doesn't make
    // exit imminent (still 6 cards after cha+straight). DMQS R2 had Eve cha
    // with 13 cards on opponent trigger and lose her pair to a counter-go;
    // requiring hand ≤ 9 means this path only fires when cha+straight brings
    // the bot to ≤ 2 cards (one play from exit).
    if (player.hand.length <= 9) {
      const chaCardIds = new Set(matchingCards.slice(0, 2).map(c => c.id));
      const hasIntactExitStraight = findValidStraights(player.hand, null).some(
        s => s.length >= 5 && !s.some(c => chaCardIds.has(c.id)),
      );
      if (hasIntactExitStraight) return 'cha';
    }

    // LOW rank speculative chas: only cha when remaining copies are ≤ 1 (high
    // chance no opponent has the rank and the cha wins), or exactly 2 with a
    // strong bias to decline. With 3+ copies remaining in others' hands, an
    // opponent likely has it and will win the go-single — burning our cha pair
    // for nothing. The previous "hand ≥ 8 → 30% cha" path was a hand-thinning
    // hedge, but in practice it caused exactly this loss pattern (DMQS R2).
    if (afterChaRemaining === 1) {
      return Math.random() < 0.6 ? 'cha' : 'decline';
    }
    if (afterChaRemaining === 2) {
      return Math.random() < 0.3 ? 'cha' : 'decline';
    }
  }

  return 'decline';
}

/**
 * Common play logic with clear priority hierarchy.
 *
 * DECISION PRIORITY (highest to lowest):
 * ┌─────────────────────────────────────────────────────────────┐
 * │ P0: INTERRUPTS — cha-go, defuse (special mechanics)        │
 * │ P1: SELF EXIT  — if 1-2 cards, always try to get out       │
 * │ P2: TEAMMATE   — don't play over teammate (unless exiting) │
 * │ P3: BLOCKING   — prevent opponents from going out          │
 * │ P4: OPENING    — lead with optimal format for situation     │
 * │ P5: RESPONDING — beat the current play efficiently          │
 * │ P6: CONSERVING — save resources when no pressure            │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Within each priority, more specific conditions override general ones.
 */
function smartPlayDecision(
  engine: GameEngine,
  playerId: string,
  opts: BotPlayOptions = {},
): ReturnType<PlayerStrategy['decidePlay']> {
  const state = engine.getState();
  const validActions = engine.getValidActions(playerId);
  const player = state.players.find(p => p.id === playerId)!;
  const round = state.round;
  const handSize = player.hand.length;

  // ============================================================
  // P0: INTERRUPTS — cha-go and defuse (special game mechanics)
  // These are time-sensitive actions that override normal play.
  // ============================================================

  // Cha-go: use smart decision considering turn order + card counting
  if ((validActions.includes('cha') || validActions.includes('go_cha')) && round?.chaGoState) {
    const triggerRank = round.chaGoState.triggerRank;
    const tc = player.hand.filter(c => c.rank === triggerRank);

    if (tc.length >= 2) {
      const decision = decideChaGo(engine, playerId, triggerRank, tc);
      if (decision === 'cha') {
        // When we hold exactly 3 of the trigger rank and go_cha is valid, playing all
        // 3 as go_cha is strictly better than cha: same skip effect but uses all cards
        // cleanly rather than leaving 1 stranded.
        if (tc.length === 3 && validActions.includes('go_cha')) {
          return { action: 'go_cha', cards: tc.slice(0, 3) };
        }
        if (validActions.includes('cha')) {
          return { action: 'cha', cards: tc.slice(0, 2) };
        }
      }
    }
    if (validActions.includes('decline_cha')) return { action: 'decline_cha' };
  }
  if (validActions.includes('decline_cha')) return { action: 'decline_cha' };

  // Defuse: almost always correct — prevents red 10 bomb from winning the round.
  // Only exception would be if the red 10 bomb was played by a teammate, but
  // that's extremely rare and still usually worth defusing for control.
  if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
    const needed = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
    const bt = player.hand.filter(c => isBlackTen(c));
    if (bt.length >= needed) return { action: 'defuse', cards: bt.slice(0, needed) };
  }

  if (!validActions.includes('play')) return { action: 'pass' };

  // Cha-go waiting_go: play the go card if we have one.
  // Strategic consideration: playing go gives the next player a chance at final cha.
  // But NOT playing go means we pass and someone else might go instead.
  // Generally, playing go is correct because it advances the cha-go toward resolution.
  if (round?.lastPlay && round.chaGoState?.phase === 'waiting_go') {
    const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
    if (tc.length >= 1) return { action: 'play', cards: [tc[0]] };
    return { action: 'pass' };
  }

  // ============================================================
  // Compute shared context used by P1-P6
  // ============================================================
  const opponents = state.players.filter(
    p => !p.isOut && p.id !== playerId && p.team !== player.team,
  );
  const teammates = state.players.filter(
    p => !p.isOut && p.id !== playerId && p.team === player.team,
  );
  const opponentMinHand = opponents.length > 0
    ? Math.min(...opponents.map(p => p.handSize))
    : 99;
  const teammateMinHand = teammates.length > 0
    ? Math.min(...teammates.map(p => p.handSize))
    : 99;
  const highThreat = opponentMinHand <= 2;
  const medThreat = opponentMinHand <= 3;
  const isLastPlayByTeammate = round?.lastPlay ? lastPlayByTeammate(engine, playerId) : false;
  const isLastPlayerDangerous = (() => {
    if (!round?.lastPlay) return false;
    const lp = state.players.find(p => p.id === round.lastPlay!.playerId);
    return lp && !lp.isOut && lp.team !== player.team && lp.handSize <= 3;
  })();

  // Race-posture assessment (Fix D). When my hand is too weak to actually win
  // the race (low cards, few winners, opponent close to exit), defensive mode
  // tells the bot: don't burn winners trying to block — pass and conserve.
  // The activeOpponents <=1 case in assessRaceMode flips back to aggressive
  // so we still race the last opponent. Can be disabled for legacy A/B.
  const raceMode = opts.disableDefensiveMode
    ? 'aggressive'
    : assessRaceMode(player.hand, player, state.players).mode;
  const isDefensive = raceMode === 'defensive';

  // ============================================================
  // P1: SELF EXIT — if we have 1-2 cards, always try to get out
  // This overrides ALL conservation and teammate logic.
  // Getting out reduces team liability and sets/supports scoring.
  // ============================================================
  const tryingToExit = handSize <= 2;

  // ============================================================
  // P2: TEAMMATE AWARENESS
  // Pass to let teammate keep the lead, UNLESS:
  //   - We're trying to exit (P1)
  //   - An opponent is about to go out (P3 will handle)
  // ============================================================

  // P2a: TEAMMATE'S UNBEATABLE PLAY — always pass, even if we could exit.
  //
  // An "unbeatable" teammate play = a bomb, a 2-single, or a pair of 2s.
  // No non-bomb play can beat any of these.
  //
  // Even if WE have a bigger bomb that would exit our whole hand, passing is
  // strictly better in almost every case:
  //   1. Overbombing locks out our teammate (their bomb is smaller than ours)
  //   2. After we exit, the next leader is likely an opponent (bad — they open
  //      freely and can exit a small hand with whatever format suits them)
  //   3. Passing lets teammate win the round and lead the next round with
  //      strategic flexibility — they can play pairs/straights that block
  //      opponents with 1-2 cards from exiting
  //   4. Our bomb is preserved for future threats
  //
  // We trust teammate's bomb to win the round. If an opponent has a bigger
  // bomb, they'll play it — and THEN we can decide whether to bomb back.
  if (isLastPlayByTeammate && round?.lastPlay) {
    const lp = round.lastPlay;
    const teammateUnbeatable =
      lp.format === 'bomb' ||
      (lp.format === 'single' && lp.cards[0].rank === '2') ||
      (lp.format === 'pair' && lp.cards[0].rank === '2');
    if (teammateUnbeatable) {
      return { action: 'pass' };
    }
  }

  // Pass when a teammate is winning, even under high threat.
  // Rationale: if the opponent can't beat the teammate's play they'll pass anyway;
  // if they can beat it they'll reveal themselves and we still have our bomb for
  // the follow-up turn. Bombing over a winning teammate wastes a bomb for no gain.
  if (isLastPlayByTeammate && !tryingToExit) {
    return { action: 'pass' };
  }

  // ============================================================
  // P4: OPENING PLAY (we're the leader)
  // Priority within opening:
  //   a. If WE have 1-2 cards: play whatever gets us out
  //   b. If TEAMMATE has 1-2 cards: lead singles so they can go out
  //   c. If OPPONENT has 1 card: lead pairs/straights (they can't match)
  //   d. If OPPONENT has 2 cards: lead straights (they can't match)
  //   e. Default: use chooseBestOpening scoring
  // ============================================================
  if (round && round.currentFormat === null && round.leaderId === playerId) {
    // (a) We're about to go out — play whatever finishes us
    if (tryingToExit) {
      // Play all remaining cards if they form a valid combo
      if (handSize === 1) return { action: 'play', cards: [player.hand[0]] };
      const fmt = detectFormat(player.hand);
      if (fmt) return { action: 'play', cards: [...player.hand] };
      // Can't finish in one play. Choosing which card to lead with matters:
      //   - If an opponent is near-exit (≤2 cards), lead our HIGHEST single
      //     to block them. Leading low hands them the round.
      //   - Otherwise lead our LOWEST, saving the high card to respond with.
      const byDesc = [...player.hand].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
      if (opponentMinHand <= 2) {
        return { action: 'play', cards: [byDesc[0]] };
      }
      return { action: 'play', cards: [player.hand[0]] };
    }

    // (b) Teammate has 1-2 cards — lead with singles to give them a chance to play out.
    // Prefer non-2 singles: a 2-single wins the round but wastes a power card and may
    // block the teammate from playing their remaining card(s) this round.
    if (teammateMinHand <= 2 && !highThreat) {
      const singles = findValidSingles(player.hand, null, true);
      if (singles.length > 0) {
        const nonTwo = singles.filter(s => s[0].rank !== '2');
        const pool = nonTwo.length > 0 ? nonTwo : singles;
        return { action: 'play', cards: sortByLowestRank(pool)[0] };
      }
    }

    // (c) Opponent has 1 card — lead with multi-card plays they can't match.
    //     If no multi-card play is available (e.g. we only have 2 mismatched
    //     cards), lead with our HIGHEST single instead of the lowest — leading
    //     low here is a catastrophic mistake because the 1-card opponent will
    //     almost certainly have something that beats a low card and they exit.
    //     Leading high forces them to either have an even higher card (less
    //     likely) or pass.
    //     Skipped in defensive mode: we don't mind the opp exiting (they're
    //     out of our race), and burning a high single just to block is wasteful.
    if (opponentMinHand <= 1 && !isDefensive) {
      const pairs = findValidPairs(player.hand, null, true);
      if (pairs.length > 0) return { action: 'play', cards: sortByLowestRank(pairs)[0] };
      const straights = findValidStraights(player.hand, null);
      if (straights.length > 0) return { action: 'play', cards: straights[0] };
      const ps = findValidPairedStraights(player.hand, null);
      if (ps.length > 0) return { action: 'play', cards: ps[0] };
      // Must play a single — pick the highest non-bomb card.
      const bombRanks = getBombRanks(player.hand);
      const pool = player.hand.filter(c => !bombRanks.has(c.rank));
      const src = pool.length > 0 ? pool : player.hand;
      const highest = [...src].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
      return { action: 'play', cards: [highest] };
    }

    // (d) Opponent has 2 cards — straights block them, or lead a high single.
    //     Skipped in defensive mode for the same reason as (c).
    if (opponentMinHand <= 2 && !isDefensive) {
      const straights = findValidStraights(player.hand, null);
      if (straights.length > 0) return { action: 'play', cards: straights[0] };
      const ps = findValidPairedStraights(player.hand, null);
      if (ps.length > 0) return { action: 'play', cards: ps[0] };
      // Try pairs — clears 2 cards and harder for a 2-card opponent to beat than a single.
      // Use the highest-rank pair to minimise the chance the opponent can beat it.
      const blockPairs = findValidPairs(player.hand, null, true);
      if (blockPairs.length > 0) {
        const byHighest = [...blockPairs].sort((a, b) => rankValue(b[0].rank) - rankValue(a[0].rank));
        return { action: 'play', cards: byHighest[0] };
      }
      // No multi-card option: a high single is safer than a low single because
      // a 2-card opponent with a high-ish card could still beat a low lead.
      const bombRanks = getBombRanks(player.hand);
      const pool = player.hand.filter(c => !bombRanks.has(c.rank));
      const src = pool.length > 0 ? pool : player.hand;
      const highest = [...src].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
      return { action: 'play', cards: [highest] };
    }

    // (e) Default: use the scoring system to pick the best opening
    const bestOpening = chooseBestOpening(player.hand, opts);
    if (bestOpening) return { action: 'play', cards: bestOpening };
    return { action: 'play', cards: [player.hand[0]] };
  }

  // ============================================================
  // P5 + P6: RESPONDING TO A PLAY
  // Find all possible plays, sort cheapest first, then apply
  // conservation filters based on threat level.
  // When threatened, drop bomb preservation to ensure we find all options.
  // ============================================================
  if (round?.lastPlay) {
    // When under high threat, never preserve bombs — use everything available
    const preserveBombs = !highThreat && !isLastPlayerDangerous;
    let bp = findBeatingPlays(player.hand, round.lastPlay, preserveBombs);

    // DESPERATE MEASURES: if high threat and no plays found, break pairs/straights
    // to find individual cards that can beat the current play
    if (bp.length === 0 && (highThreat || isLastPlayerDangerous)) {
      // Force find: try every single card against the last play
      for (const c of player.hand) {
        if (canBeat([c], round.lastPlay)) {
          bp.push([c]);
        }
      }
      // Also try every possible pair
      const groups = groupByRank(player.hand);
      for (const [, cards] of groups) {
        if (cards.length >= 2) {
          const pair = [cards[0], cards[1]];
          if (canBeat(pair, round.lastPlay)) bp.push(pair);
        }
        // And bombs
        if (cards.length >= 3) {
          if (canBeat(cards.slice(0, 3), round.lastPlay)) bp.push(cards.slice(0, 3));
        }
      }
    }

    // Red10×2 is uniquely costly to play: ~20% defuse risk (opponent's black-10
    // pair neutralizes it), immediate team reveal of both red 10s (giving
    // opponents perfect info), and loss of the team's strongest interrupt
    // resource. Only spend it at near-exit hand sizes where the round-win value
    // is real (handSize ≤ 4 means playing this 2-card bomb reduces hand to ≤ 2,
    // putting the player one play from exit).
    if (handSize > 4) {
      bp = bp.filter(p => {
        const bomb = classifyBomb(p);
        return bomb?.type !== 'red10_2';
      });
    }

    if (bp.length > 0) {
      // Sort: prefer non-bombs over bombs, weaker plays over stronger
      const sorted = [...bp].sort((a, b) => {
        const aBomb = classifyBomb(a);
        const bBomb = classifyBomb(b);
        if (aBomb && bBomb) {
          if (aBomb.length !== bBomb.length) return aBomb.length - bBomb.length;
          return aBomb.rankValue - bBomb.rankValue;
        }
        if (aBomb && !bBomb) return 1;
        if (!aBomb && bBomb) return -1;
        const aMin = Math.min(...a.map(c => rankValue(c.rank)));
        const bMin = Math.min(...b.map(c => rankValue(c.rank)));
        return aMin - bMin;
      });
      const cheapest = sorted[0];

      const playMinRank = Math.min(...cheapest.map(c => rankValue(c.rank)));
      const isBombPlay = classifyBomb(cheapest) !== null;
      // A play is bomb-breaking if it reduces any bomb-rank group below 3 cards,
      // destroying the bomb. This covers both 2-card pairs and straights that
      // consume a card from a 3-of-a-kind group.
      const bombRanksInHand = getBombRanks(player.hand);
      const handGroups = groupByRank(player.hand);
      const isBreakingBomb =
        !isBombPlay &&
        cheapest.some(c => {
          if (!bombRanksInHand.has(c.rank)) return false;
          const groupSize = handGroups.get(c.rank)?.length ?? 0;
          const playCount = cheapest.filter(x => x.rank === c.rank).length;
          return groupSize - playCount < 3;
        });

      // --- P1: trying to exit — always play ---
      if (tryingToExit) {
        return { action: 'play', cards: cheapest };
      }

      // --- Near-exit: a beating play would bring hand to ≤2 cards ---
      // Treat this as urgently as P1 — getting into exit range is high priority.
      // Non-bomb plays: any time hand ≤ 7. Bombs: only when hand ≤ 5.
      if (handSize <= 7) {
        const nearExitPlay = sorted.find(play => {
          const isBomb = classifyBomb(play) !== null;
          return handSize - play.length <= 2 && (!isBomb || handSize <= 5);
        });
        if (nearExitPlay) return { action: 'play', cards: nearExitPlay };
      }

      // --- Defensive mode: don't burn winners when we can't win the race ---
      // If the cheapest beating play uses a "winner" (bomb, A-pair, or
      // anything with min rank ≥ A), pass and conserve. Carve-outs:
      //   - tryingToExit (P1) already returned above, so we're not blocking exit.
      //   - isLastPlayByTeammate already returned pass above, so not affected.
      //   - Near-exit (≤7 cards with multi-card play to ≤2) also returned above.
      // The defensive-mode trigger requires my hand ≥ 6, so this only fires
      // mid-game.
      if (isDefensive && (isBombPlay || playMinRank >= 11)) {
        return { action: 'pass' };
      }

      // --- P3: blocking dangerous opponents ---
      // Must-block reasoning only applies if the dangerous opponent(s) can still
      // play THIS round. Once they've passed, the round will resolve without
      // their further input, so escalating is just burning resources.
      const dangerousOpps = opponents.filter(o => o.handSize <= 2);
      const allDangerousOppsPassed =
        !opts.disableMustBlockPassedCheck &&
        dangerousOpps.length > 0 &&
        dangerousOpps.every(o => hasPassedThisRound(o.id, round, state.players));

      // Even if all ≤2-card opponents have passed, isLastPlayerDangerous still
      // wants us to win this round so we lead next round (preventing the
      // dangerous last player from leading with their small hand).
      const effectivelyHighThreat = (highThreat && !allDangerousOppsPassed) || isLastPlayerDangerous;

      if (effectivelyHighThreat) {
        // Don't burn a bomb on a single lead unless we're forced. Singles chains
        // have natural counters (2-singles), and bombing a single often gets
        // counter-bombed. Two carve-outs: trying to exit (bomb might force exit)
        // or must-block an opponent at ≤ 1 card. Can be disabled via
        // opts.disableSingleBombGuard for legacy A/B testing.
        if (
          !opts.disableSingleBombGuard &&
          isBombPlay &&
          round.lastPlay.format === 'single' &&
          !tryingToExit &&
          opponentMinHand > 1
        ) {
          return { action: 'pass' };
        }
        // Conservative bomb use: avoid burning a triple against a non-bomb if a
        // large-hand opponent (8+ cards) is still active — they likely have a
        // bigger bomb and will outbid, making our burn wasteful.
        if (
          isBombPlay &&
          cheapest.length === 3 &&
          round.lastPlay.format !== 'bomb' &&
          !tryingToExit &&
          opponents.some(p => p.handSize >= 8)
        ) {
          return { action: 'pass' };
        }
        return { action: 'play', cards: cheapest };
      }

      // --- P5: medium threat — play non-bombs freely ---
      if (medThreat) {
        if (!isBombPlay && !isBreakingBomb) return { action: 'play', cards: cheapest };
        // Bomb (or bomb-breaking pair) on medium threat: only if hand is small
        if (handSize <= 4) return { action: 'play', cards: cheapest };
        return { action: 'pass' };
      }

      // --- P6: CONSERVATION (no threat, opponent min hand > 3) ---

      // Never bomb (or break a bomb) on non-bomb plays when conserving
      if ((isBombPlay || isBreakingBomb) && round.lastPlay.format !== 'bomb') {
        return { action: 'pass' };
      }

      // Bomb-vs-bomb: don't use special bombs (4,4,A) against weak normal bombs
      if (isBombPlay && round.lastPlay.format === 'bomb') {
        const ourBomb = classifyBomb(cheapest);
        const theirBomb = classifyBomb(round.lastPlay.cards);
        if (ourBomb && theirBomb) {
          if (ourBomb.type !== 'normal' && theirBomb.type === 'normal' && theirBomb.rankValue < 8) {
            return { action: 'pass' };
          }
        }
      }

      // Don't waste A (11) or 2 (12) to beat cards below Q (9)
      const lastPlayMaxRank = Math.max(...round.lastPlay.cards.map(c => rankValue(c.rank)));
      if (playMinRank >= 11 && lastPlayMaxRank < 9) {
        return { action: 'pass' };
      }
      // Don't waste K (10) to beat cards below 8 (5)
      if (playMinRank >= 10 && lastPlayMaxRank < 5) {
        return { action: 'pass' };
      }

      // Hand size 3-4 without threat: play normally but not bombs
      // (bombs already filtered above)
      return { action: 'play', cards: cheapest };
    }
  }

  return { action: 'pass' };
}

// ---- Built-in strategies ----

export const AggressiveStrategy: PlayerStrategy = {
  name: 'Aggressive',
  decideDoubling(engine, playerId) {
    return standardDoublingDecision(engine, playerId, 9);
  },
  decidePlay(engine, playerId) {
    return smartPlayDecision(engine, playerId);
  },
};

export const SmartRacerStrategy: PlayerStrategy = {
  name: 'SmartRacer',
  decideDoubling(engine, playerId) {
    return standardDoublingDecision(engine, playerId, 9);
  },
  decidePlay(engine, playerId) {
    return smartPlayDecision(engine, playerId);
  },
};

export const HandSizeExploiterStrategy: PlayerStrategy = {
  name: 'HandSizeExploiter',
  decideDoubling(engine, playerId) {
    // Conservative — double with strength >= 9
    return standardDoublingDecision(engine, playerId, 9);
  },
  decidePlay(engine, playerId) {
    // This strategy focuses on multi-card plays to exploit opponents with small hands
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    // Use standard logic for cha-go, defuse, teammate awareness
    const baseResult = smartPlayDecision(engine, playerId);

    // Override opening: prefer multi-card plays to block opponents with few cards
    if (round && round.currentFormat === null && round.leaderId === playerId) {
      // Check if any opponent has few cards
      const opponents = state.players.filter(
        p => !p.isOut && p.id !== playerId && p.team !== player.team,
      );
      const smallHandOpponent = opponents.find(p => p.handSize <= 2);

      if (smallHandOpponent) {
        // Play pairs/straights to block them from playing singles
        const pairs = findValidPairs(player.hand, null, true);
        if (pairs.length > 0) return { action: 'play', cards: sortByLowestRank(pairs)[0] };
        const straights = findValidStraights(player.hand, null);
        if (straights.length > 0) return { action: 'play', cards: straights[0] };
      }
    }

    return baseResult;
  },
};

export const TeamCoordinatorStrategy: PlayerStrategy = {
  name: 'TeamCoordinator',
  decideDoubling(engine, playerId) {
    // Very conservative — double with strength >= 9
    return standardDoublingDecision(engine, playerId, 9);
  },
  decidePlay(engine, playerId) {
    return smartPlayDecision(engine, playerId);
  },
};

/**
 * Pre-Fix-D variant for A/B testing — disables only defensive mode while
 * keeping all the earlier fixes (FSYS, 2v4, single-bomb, must-block-passed).
 * Used to isolate Fix D's effect on scoring failure rate and payout magnitude.
 * NOT in ALL_STRATEGIES — opt-in only.
 */
export const PreFixDStrategy: PlayerStrategy = {
  name: 'PreFixD',
  decideDoubling(engine, playerId) {
    return standardDoublingDecision(engine, playerId, 9);
  },
  decidePlay(engine, playerId) {
    return smartPlayDecision(engine, playerId, {
      disableDefensiveMode: true,
    });
  },
};

/**
 * Legacy variant for A/B testing only — disables all five strategy fixes
 * shipped 2026-04-29 / 2026-04-30 / 2026-05 (FSYS bomb preservation, 2v4
 * doubling penalty, single-bomb guard, must-block-passed check, defensive
 * mode). Behaves like SmartRacerStrategy did before those commits. NOT in
 * ALL_STRATEGIES — intentionally opt-in.
 */
export const LegacyPreFixesStrategy: PlayerStrategy = {
  name: 'LegacyPreFixes',
  decideDoubling(engine, playerId) {
    return standardDoublingDecision(engine, playerId, 9, {
      disable2v4DoublingPenalty: true,
    });
  },
  decidePlay(engine, playerId) {
    return smartPlayDecision(engine, playerId, {
      disableBombPreservation: true,
      disable2v4DoublingPenalty: true,
      disableSingleBombGuard: true,
      disableMustBlockPassedCheck: true,
      disableDefensiveMode: true,
    });
  },
};

// ---- Bot Player Interface ----

export interface BotPlayer {
  id: string;
  name: string;
  strategyName: string;
  seatIndex: number;
}

// ---- Available strategies (rotated through) ----

const ALL_STRATEGIES: PlayerStrategy[] = [
  SmartRacerStrategy,
  HandSizeExploiterStrategy,
  TeamCoordinatorStrategy,
  AggressiveStrategy,
];

const BOT_NAMES = ['Bot Alice', 'Bot Bob', 'Bot Charlie', 'Bot Dave', 'Bot Eve'];

// ---- Bot Action types ----

export type BotAction =
  | { action: 'play'; cards: Card[] }
  | { action: 'pass' }
  | { action: 'cha'; cards: Card[] }
  | { action: 'go_cha'; cards: Card[] }
  | { action: 'decline_cha' }
  | { action: 'defuse'; cards: Card[] }
  | { action: 'double'; bombCards?: Card[] }
  | { action: 'skip' }
  | { action: 'quadruple'; bombCards?: Card[] }
  | { action: 'skip_quadruple' };

// ---- BotManager ----

export class BotManager {
  /** roomId -> BotPlayer[] */
  private roomBots = new Map<string, BotPlayer[]>();
  /** botId -> strategy */
  private botStrategies = new Map<string, PlayerStrategy>();

  /**
   * Fill remaining seats in a room with bots.
   * Returns the created BotPlayer array.
   */
  fillWithBots(roomId: string, existingPlayerCount: number): BotPlayer[] {
    const botsNeeded = 6 - existingPlayerCount;
    if (botsNeeded <= 0) return [];

    const bots: BotPlayer[] = [];
    for (let i = 0; i < botsNeeded; i++) {
      const strategy = ALL_STRATEGIES[i % ALL_STRATEGIES.length];
      const bot: BotPlayer = {
        id: `bot-${i}`,
        name: BOT_NAMES[i % BOT_NAMES.length],
        strategyName: strategy.name,
        seatIndex: -1, // will be assigned by lobby
      };
      bots.push(bot);
      this.botStrategies.set(bot.id, strategy);
    }

    this.roomBots.set(roomId, bots);
    return bots;
  }

  /**
   * Process a bot's turn. Returns the action the bot wants to take.
   */
  processBotTurn(roomId: string, botId: string, engine: GameEngine): BotAction | null {
    const strategy = this.botStrategies.get(botId);
    if (!strategy) return null;

    const state = engine.getState();

    // Doubling phase
    if (state.phase === 'doubling') {
      const decision = strategy.decideDoubling(engine, botId);
      return decision;
    }

    // Playing phase
    if (state.phase === 'playing') {
      const decision = strategy.decidePlay(engine, botId);
      return decision;
    }

    return null;
  }

  /**
   * Check if a player ID belongs to a bot.
   */
  isBot(playerId: string): boolean {
    return playerId.startsWith('bot-');
  }

  /**
   * Get all bots in a room.
   */
  getBotsInRoom(roomId: string): BotPlayer[] {
    return this.roomBots.get(roomId) ?? [];
  }

  /**
   * Clean up bots when a game ends.
   */
  cleanup(roomId: string): void {
    const bots = this.roomBots.get(roomId) ?? [];
    for (const bot of bots) {
      this.botStrategies.delete(bot.id);
    }
    this.roomBots.delete(roomId);
  }
}
