/**
 * Advanced strategies that play with game-awareness:
 * - Team-aware: race to get out vs. block opponents
 * - Hand-size-aware: exploit opponents' limited play options
 * - Scoring-aware: different behavior before/after scoring team is set
 */
import type { GameEngine } from '../../src/game/GameEngine.js';
import type { Card, Play, Team, PlayerState } from '@red10/shared';
import { detectFormat, canBeat, classifyBomb, isBlackTen } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';
import type { PlayerStrategy } from './strategies.js';
import {
  findValidSingles,
  findValidPairs,
  findValidStraights,
  findValidPairedStraights,
  findBombs,
  findOpeningPlays,
  getBombRanks,
} from './strategies.js';

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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Situation Analysis Helpers ----

interface GameSituation {
  myTeam: Team;
  scoringTeam: Team | null;
  iAmOnScoringTeam: boolean | null; // null if no scoring team yet
  myHandSize: number;
  myTeammates: PlayerState[];
  opponents: PlayerState[];
  activeOpponents: PlayerState[];  // not out
  activeTeammates: PlayerState[];  // not out (including self)
  dangerOpponent: PlayerState | null;  // opponent closest to going out
  dangerTeammate: PlayerState | null;  // teammate closest to going out (good for us)
  lastOpponentHandSize: number;  // smallest hand among active opponents
  allTeammatesOut: boolean;
  allOpponentsOut: boolean;
  // Scoring race state
  scoringTeamAllOut: boolean;
  opposingTeamAllOut: boolean;
  // Am I the last player on my team still in?
  iAmLastOnMyTeam: boolean;
}

function analyzeSituation(engine: GameEngine, playerId: string): GameSituation {
  const state = engine.getState();
  const me = state.players.find(p => p.id === playerId)!;
  const myTeam = me.team!;
  const scoringTeam = state.scoringTeam;

  const teammates = state.players.filter(p => p.team === myTeam && p.id !== playerId);
  const opponents = state.players.filter(p => p.team !== myTeam);
  const activeOpponents = opponents.filter(p => !p.isOut);
  const activeTeammates = state.players.filter(p => p.team === myTeam && !p.isOut);

  // Find the opponent with fewest cards (most dangerous — closest to going out)
  let dangerOpponent: PlayerState | null = null;
  let minOpponentCards = Infinity;
  for (const opp of activeOpponents) {
    if (opp.handSize < minOpponentCards) {
      minOpponentCards = opp.handSize;
      dangerOpponent = opp;
    }
  }

  // Find teammate closest to going out (to help them)
  let dangerTeammate: PlayerState | null = null;
  let minTeammateCards = Infinity;
  for (const tm of activeTeammates) {
    if (tm.id !== playerId && tm.handSize < minTeammateCards) {
      minTeammateCards = tm.handSize;
      dangerTeammate = tm;
    }
  }

  const scoringMembers = scoringTeam ? state.players.filter(p => p.team === scoringTeam) : [];
  const opposingMembers = scoringTeam
    ? state.players.filter(p => p.team !== scoringTeam)
    : [];

  return {
    myTeam,
    scoringTeam,
    iAmOnScoringTeam: scoringTeam ? myTeam === scoringTeam : null,
    myHandSize: me.handSize,
    myTeammates: teammates,
    opponents,
    activeOpponents,
    activeTeammates,
    dangerOpponent,
    dangerTeammate,
    lastOpponentHandSize: minOpponentCards === Infinity ? 13 : minOpponentCards,
    allTeammatesOut: teammates.every(p => p.isOut),
    allOpponentsOut: activeOpponents.length === 0,
    scoringTeamAllOut: scoringMembers.every(p => p.isOut),
    opposingTeamAllOut: opposingMembers.every(p => p.isOut),
    iAmLastOnMyTeam: activeTeammates.length === 1,
  };
}

/**
 * Choose opening format that blocks an opponent with a specific hand size.
 * - 1 card: they can only play singles. Lead with pairs, straights, or bombs.
 * - 2 cards: they can only play singles or pairs. Lead with straights.
 * - 3+ cards: they might have any format. Normal play.
 */
function findBlockingOpening(hand: Card[], opponentHandSize: number, preserveBombs = true): Card[] | null {
  const bombRanks = preserveBombs ? getBombRanks(hand) : new Set<string>();
  const groups = groupByRank(hand);

  if (opponentHandSize === 1) {
    // Opponent can ONLY play singles. Lead with pairs to lock them out.
    // They also can't beat a 2 (highest single) so a 2 is great as a single.
    // But pairs are safer since they literally can't play.
    for (const [rank, cards] of groups) {
      if (preserveBombs && bombRanks.has(rank) && cards.length < 5) continue;
      if (cards.length >= 2) {
        return [cards[0], cards[1]];
      }
    }
    // Fallback: play highest single (they probably can't beat a 2)
    const sorted = [...hand].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
    return [sorted[0]];
  }

  if (opponentHandSize === 2) {
    // Opponent can play singles or pairs, but NOT straights (need 3+).
    // Lead with a straight if possible.
    const straights = findValidStraights(hand, null);
    if (straights.length > 0) {
      return straights[0];
    }
    // Or paired straight (needs 6+ cards, they definitely can't match)
    const pairedStraights = findValidPairedStraights(hand, null);
    if (pairedStraights.length > 0) {
      return pairedStraights[0];
    }
    // Fallback: pairs still work (they might have a pair, but it's 50/50)
    for (const [rank, cards] of groups) {
      if (preserveBombs && bombRanks.has(rank) && cards.length < 5) continue;
      if (cards.length >= 2) {
        return [cards[0], cards[1]];
      }
    }
  }

  if (opponentHandSize <= 4) {
    // They probably can't form long straights. Lead with 5+ card straights.
    const straights = findValidStraights(hand, null);
    const longStraights = straights.filter(s => s.length > opponentHandSize);
    if (longStraights.length > 0) {
      return longStraights[0];
    }
  }

  return null;
}

/**
 * Find plays that beat the current play, sorted by preference:
 * - Prefer non-bomb cards
 * - Prefer lower rank (save high cards)
 * - Preserve bomb ranks
 */
function findBeatingPlays(hand: Card[], lastPlay: Play, preserveBombs = true): Card[][] {
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
    const allBombs = findBombs(hand);
    for (const bomb of allBombs) {
      if (canBeat(bomb, lastPlay)) {
        results.push(bomb);
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

function sortByLowestRank(plays: Card[][]): Card[][] {
  return [...plays].sort((a, b) => {
    const aVal = Math.min(...a.map(c => rankValue(c.rank)));
    const bVal = Math.min(...b.map(c => rankValue(c.rank)));
    return aVal - bVal;
  });
}

function sortByHighestRank(plays: Card[][]): Card[][] {
  return [...plays].sort((a, b) => {
    const aMax = Math.max(...a.map(c => rankValue(c.rank)));
    const bMax = Math.max(...b.map(c => rankValue(c.rank)));
    return bMax - aMax; // descending
  });
}

// ---- Common cha-go / defuse handlers ----

function handleChaGoAndDefuse(
  engine: GameEngine,
  playerId: string,
  situation: GameSituation,
  chaAggressiveness: 'always' | 'smart' | 'never',
): ReturnType<PlayerStrategy['decidePlay']> | null {
  const state = engine.getState();
  const validActions = engine.getValidActions(playerId);
  const player = state.players.find(p => p.id === playerId)!;
  const round = state.round;

  // Go-cha: always take it — it's a free round win
  if (validActions.includes('go_cha') && round?.chaGoState) {
    const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
    if (triggerCards.length >= 3) {
      return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
    }
  }

  // Cha decisions
  if (validActions.includes('cha') && round?.chaGoState) {
    const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);

    if (chaAggressiveness === 'always' && triggerCards.length >= 2) {
      return { action: 'cha', cards: triggerCards.slice(0, 2) };
    }

    if (chaAggressiveness === 'smart') {
      // Don't break a 3-of-a-kind bomb
      if (triggerCards.length === 2 || triggerCards.length >= 4) {
        return { action: 'cha', cards: triggerCards.slice(0, 2) };
      }
      // 3 copies = bomb, don't break it — but consider go-cha instead
      if (triggerCards.length === 3) {
        return { action: 'go_cha', cards: triggerCards.slice(0, 3) };
      }
    }

    // 'never' or can't cha without breaking bomb
  }

  if (validActions.includes('decline_cha')) {
    return { action: 'decline_cha' };
  }

  // Defuse: do it if we're on the opposing team of the bomb player, or if we're blocking
  if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
    const neededCount = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
    const blackTens = player.hand.filter(c => isBlackTen(c));
    if (blackTens.length >= neededCount) {
      // Defuse if the bomb was played by an opponent
      const bombPlayer = state.players.find(p => p.id === round.lastPlay!.playerId);
      if (bombPlayer && bombPlayer.team !== situation.myTeam) {
        return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
      }
      // Also defuse 50% of the time even if teammate (to test the mechanic)
      if (Math.random() < 0.3) {
        return { action: 'defuse', cards: blackTens.slice(0, neededCount) };
      }
    }
  }

  return null; // No cha-go/defuse action taken
}

// ============================================================
// STRATEGY: SmartRacer
// Goal: Get out as fast as possible to set/support the scoring team.
// Before scoring team is set: play aggressively to be first out.
// After scoring team is set and I'm on it: keep racing to get teammates out.
// After scoring team is set and I'm NOT on it: switch to blocking.
// ============================================================

export const SmartRacerStrategy: PlayerStrategy = {
  name: 'SmartRacer',

  decideDoubling(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);

    if (validActions.includes('quadruple')) {
      // Quadruple if we have bombs to back it up
      const bombs = findBombs(player.hand);
      if (bombs.length >= 2) return { action: 'quadruple' };
      return { action: 'skip_quadruple' };
    }

    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      // Double if we have a strong hand: 2+ bombs, or few unique ranks (easy to go out)
      const groups = groupByRank(player.hand);
      const uniqueRanks = groups.size;
      if (bombs.length >= 2 || (bombs.length >= 1 && uniqueRanks <= 5)) {
        if (player.team === 'red10') return { action: 'double' };
        if (bombs.length > 0) return { action: 'double', bombCards: bombs[0] };
      }
    }

    return { action: 'skip' };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;
    const situation = analyzeSituation(engine, playerId);

    // Handle cha-go / defuse
    const chaGoResult = handleChaGoAndDefuse(engine, playerId, situation, 'smart');
    if (chaGoResult) return chaGoResult;

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // ---- Determine mode: RACE or BLOCK ----
    const isRacing = situation.iAmOnScoringTeam === null || situation.iAmOnScoringTeam === true;

    // ---- RACING MODE ----
    if (isRacing) {
      // Leader: open aggressively
      if (round && round.currentFormat === null && round.leaderId === playerId) {
        // If I have a long straight + a bomb, play the straight to dump cards fast
        const straights = findValidStraights(player.hand, null);
        const bombs = findBombs(player.hand);
        if (straights.length > 0 && bombs.length > 0) {
          // Play longest straight to dump the most cards
          const sorted = [...straights].sort((a, b) => b.length - a.length);
          return { action: 'play', cards: sorted[0] };
        }

        // Play paired straights to dump cards
        const pairedStraights = findValidPairedStraights(player.hand, null);
        if (pairedStraights.length > 0) {
          const sorted = [...pairedStraights].sort((a, b) => b.length - a.length);
          return { action: 'play', cards: sorted[0] };
        }

        // Play pairs to reduce hand (2 cards at once)
        const pairs = findValidPairs(player.hand, null, true);
        if (pairs.length > 0) {
          return { action: 'play', cards: sortByLowestRank(pairs)[0] };
        }

        // Singles — preserve bombs
        const singles = findValidSingles(player.hand, null, true);
        if (singles.length > 0) {
          return { action: 'play', cards: sortByLowestRank(singles)[0] };
        }

        return { action: 'play', cards: [player.hand[0]] };
      }

      // Following: always play if possible
      if (round?.lastPlay) {
        if (round.chaGoState?.phase === 'waiting_go') {
          const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
          if (triggerCards.length >= 1) return { action: 'play', cards: [triggerCards[0]] };
          return { action: 'pass' };
        }

        const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
        if (beatingPlays.length > 0) {
          // Play lowest valid to save high cards
          return { action: 'play', cards: sortByLowestRank(beatingPlays)[0] };
        }
      }

      return { action: 'pass' };
    }

    // ---- BLOCKING MODE ----
    // I'm on the opposing team. Prevent the scoring team from completing.
    return blockingPlay(engine, playerId, player, round, situation, validActions);
  },
};

// ============================================================
// STRATEGY: HandSizeExploiter
// Focuses on exploiting opponents' hand sizes to lock them out.
// ============================================================

export const HandSizeExploiterStrategy: PlayerStrategy = {
  name: 'HandSizeExploiter',

  decideDoubling(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);

    if (validActions.includes('quadruple')) {
      return { action: 'quadruple' };
    }

    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (player.team === 'red10') return { action: 'double' };
      if (bombs.length > 0) return { action: 'double', bombCards: bombs[0] };
    }

    return { action: 'skip' };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;
    const situation = analyzeSituation(engine, playerId);

    // Handle cha-go / defuse
    const chaGoResult = handleChaGoAndDefuse(engine, playerId, situation, 'smart');
    if (chaGoResult) return chaGoResult;

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // Leader: choose format based on opponents' hand sizes
    if (round && round.currentFormat === null && round.leaderId === playerId) {
      // Find the most dangerous opponent (fewest cards, on opposing team or unknown)
      const dangerOpp = situation.dangerOpponent;
      const dangerSize = situation.lastOpponentHandSize;

      // Try to play a format they can't match
      if (dangerOpp && dangerSize <= 4) {
        const blocking = findBlockingOpening(player.hand, dangerSize, true);
        if (blocking) {
          return { action: 'play', cards: blocking };
        }
      }

      // No specific blocking needed — play normally, dump cards
      const openings = findOpeningPlays(player.hand);
      // Prefer multi-card plays to dump hand faster
      const multiCard = openings.filter(p => p.length >= 2);
      if (multiCard.length > 0) {
        // Prefer the play that removes the most cards
        multiCard.sort((a, b) => b.length - a.length);
        return { action: 'play', cards: multiCard[0] };
      }

      // Fallback: lowest single, preserve bombs
      const singles = findValidSingles(player.hand, null, true);
      if (singles.length > 0) {
        return { action: 'play', cards: sortByLowestRank(singles)[0] };
      }
      return { action: 'play', cards: [player.hand[0]] };
    }

    // Following
    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (triggerCards.length >= 1) return { action: 'play', cards: [triggerCards[0]] };
        return { action: 'pass' };
      }

      // If an opponent with few cards played, try to beat them to prevent their win
      const lastPlayer = state.players.find(p => p.id === round.lastPlay!.playerId);
      const isOpponentPlay = lastPlayer && lastPlayer.team !== situation.myTeam;
      const opponentNearOut = isOpponentPlay && (lastPlayer?.handSize ?? 13) <= 3;

      if (opponentNearOut) {
        // Aggressively beat to prevent them from winning the round
        const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, false);
        if (beatingPlays.length > 0) {
          // Play HIGHEST to make it hard for others to beat
          return { action: 'play', cards: sortByHighestRank(beatingPlays)[0] };
        }
      }

      // Normal: play lowest, preserve bombs
      const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
      if (beatingPlays.length > 0) {
        return { action: 'play', cards: sortByLowestRank(beatingPlays)[0] };
      }
    }

    if (round && round.currentFormat === null) {
      return { action: 'play', cards: [player.hand[0]] };
    }

    return { action: 'pass' };
  },
};

// ============================================================
// STRATEGY: TeamCoordinator
// Plays differently based on team role:
// - Before scoring: race to set your team
// - Scoring team member: help teammates get out, block opponents
// - Opposing team: focus on blocking the scoring team's last player
// ============================================================

export const TeamCoordinatorStrategy: PlayerStrategy = {
  name: 'TeamCoordinator',

  decideDoubling(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);

    if (validActions.includes('quadruple')) {
      // Only quadruple if we have strong bombs
      const bombs = findBombs(player.hand);
      if (bombs.some(b => b.length >= 4)) return { action: 'quadruple' };
      return { action: 'skip_quadruple' };
    }

    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (player.team === 'red10' && bombs.length >= 1) return { action: 'double' };
      if (player.team === 'black10' && bombs.length > 0) {
        // Show smallest bomb, keep the big ones secret
        const sorted = [...bombs].sort((a, b) => a.length - b.length);
        return { action: 'double', bombCards: sorted[0] };
      }
    }

    return { action: 'skip' };
  },

  decidePlay(engine: GameEngine, playerId: string) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;
    const situation = analyzeSituation(engine, playerId);

    // Handle cha-go / defuse
    const chaGoResult = handleChaGoAndDefuse(engine, playerId, situation, 'smart');
    if (chaGoResult) return chaGoResult;

    if (!validActions.includes('play')) {
      if (validActions.includes('pass')) return { action: 'pass' };
      return { action: 'pass' };
    }

    // ---- PHASE 1: No scoring team yet — race ----
    if (situation.scoringTeam === null) {
      return racingPlay(engine, playerId, player, round, situation, validActions);
    }

    // ---- PHASE 2: I'm on scoring team ----
    if (situation.iAmOnScoringTeam) {
      // If I'm the last one on my team, I MUST get out before all opponents do
      if (situation.iAmLastOnMyTeam) {
        return racingPlay(engine, playerId, player, round, situation, validActions);
      }

      // Help teammates: if a teammate has few cards, let them win rounds
      if (situation.dangerTeammate && situation.dangerTeammate.handSize <= 2) {
        // If the round leader is my teammate, pass to let them lead/win
        if (round?.lastPlay?.playerId &&
            situation.myTeammates.some(t => t.id === round.lastPlay!.playerId)) {
          if (validActions.includes('pass')) return { action: 'pass' };
        }
      }

      // Otherwise race normally
      return racingPlay(engine, playerId, player, round, situation, validActions);
    }

    // ---- PHASE 3: I'm on opposing team — BLOCK ----
    return blockingPlay(engine, playerId, player, round, situation, validActions);
  },
};

// ============================================================
// Shared tactical functions
// ============================================================

function racingPlay(
  _engine: GameEngine,
  playerId: string,
  player: PlayerState,
  round: ReturnType<GameEngine['getState']>['round'],
  _situation: GameSituation,
  validActions: string[],
): ReturnType<PlayerStrategy['decidePlay']> {
  if (!round) return { action: 'pass' };

  // Leader: dump cards fast
  if (round.currentFormat === null && round.leaderId === playerId) {
    // Longest multi-card play first
    const straights = findValidStraights(player.hand, null);
    const pairedStraights = findValidPairedStraights(player.hand, null);
    const pairs = findValidPairs(player.hand, null, true);

    const allMulti = [...straights, ...pairedStraights, ...pairs];
    if (allMulti.length > 0) {
      allMulti.sort((a, b) => b.length - a.length);
      return { action: 'play', cards: allMulti[0] };
    }

    // If only 1 card left, play it
    if (player.hand.length === 1) {
      return { action: 'play', cards: [player.hand[0]] };
    }

    // Bomb as opener if we have other cards to play after
    const bombs = findBombs(player.hand);
    if (bombs.length >= 2) {
      // Play a bomb to take control, keep the other for later
      const sorted = [...bombs].sort((a, b) => a.length - b.length);
      return { action: 'play', cards: sorted[0] };
    }

    // Single — preserve bombs
    const singles = findValidSingles(player.hand, null, true);
    if (singles.length > 0) {
      return { action: 'play', cards: sortByLowestRank(singles)[0] };
    }
    return { action: 'play', cards: [player.hand[0]] };
  }

  // Following
  if (round.lastPlay) {
    if (round.chaGoState?.phase === 'waiting_go') {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 1) return { action: 'play', cards: [triggerCards[0]] };
      return { action: 'pass' };
    }

    const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
    if (beatingPlays.length > 0) {
      return { action: 'play', cards: sortByLowestRank(beatingPlays)[0] };
    }
  }

  if (round.currentFormat === null) {
    return { action: 'play', cards: [player.hand[0]] };
  }

  return { action: 'pass' };
}

function blockingPlay(
  _engine: GameEngine,
  playerId: string,
  player: PlayerState,
  round: ReturnType<GameEngine['getState']>['round'],
  situation: GameSituation,
  validActions: string[],
): ReturnType<PlayerStrategy['decidePlay']> {
  if (!round) return { action: 'pass' };

  const dangerSize = situation.lastOpponentHandSize;

  // Leader: choose format to block the most dangerous opponent
  if (round.currentFormat === null && round.leaderId === playerId) {
    // If the dangerous opponent has few cards, play a format they can't use
    if (dangerSize <= 4) {
      const blocking = findBlockingOpening(player.hand, dangerSize, true);
      if (blocking) {
        return { action: 'play', cards: blocking };
      }
    }

    // Default: play pairs to block 1-card opponents, preserve bombs
    const pairs = findValidPairs(player.hand, null, true);
    if (pairs.length > 0) {
      return { action: 'play', cards: sortByLowestRank(pairs)[0] };
    }

    const singles = findValidSingles(player.hand, null, true);
    if (singles.length > 0) {
      return { action: 'play', cards: sortByLowestRank(singles)[0] };
    }
    return { action: 'play', cards: [player.hand[0]] };
  }

  // Following: beat opponent plays aggressively, let teammate plays go
  if (round.lastPlay) {
    if (round.chaGoState?.phase === 'waiting_go') {
      const triggerCards = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (triggerCards.length >= 1) return { action: 'play', cards: [triggerCards[0]] };
      return { action: 'pass' };
    }

    const lastPlayer = _engine.getState().players.find(p => p.id === round.lastPlay!.playerId);
    const isOpponentPlay = lastPlayer && lastPlayer.team !== situation.myTeam;

    if (isOpponentPlay) {
      // Opponent played — we WANT to beat them to prevent round win
      const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
      if (beatingPlays.length > 0) {
        // If opponent is about to go out (1-2 cards), play HIGH to block
        if ((lastPlayer?.handSize ?? 13) <= 2) {
          return { action: 'play', cards: sortByHighestRank(beatingPlays)[0] };
        }
        return { action: 'play', cards: sortByLowestRank(beatingPlays)[0] };
      }

      // Can't beat — use a bomb if opponent is dangerous
      if ((lastPlayer?.handSize ?? 13) <= 3) {
        const bombs = findBombs(player.hand);
        const validBombs = bombs.filter(b => canBeat(b, round.lastPlay!));
        if (validBombs.length > 0) {
          return { action: 'play', cards: validBombs[0] };
        }
      }
    } else {
      // Teammate played — pass to let them win the round
      if (validActions.includes('pass')) return { action: 'pass' };
    }

    // Normal beat
    const beatingPlays = findBeatingPlays(player.hand, round.lastPlay, true);
    if (beatingPlays.length > 0) {
      return { action: 'play', cards: sortByLowestRank(beatingPlays)[0] };
    }
  }

  if (round.currentFormat === null) {
    return { action: 'play', cards: [player.hand[0]] };
  }

  return { action: 'pass' };
}
