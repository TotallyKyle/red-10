import type { GameEngine } from '../game/GameEngine.js';
import type { Card } from '@red10/shared';

// ---- Strategy Interface (mirrors simulator) ----

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

// ---- Inline strategies (simplified versions of simulator strategies) ----
// We inline them to avoid importing from __tests__ in production code.

import { detectFormat, canBeat, classifyBomb, isBlackTen, RANK_ORDER } from '@red10/shared';

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
  if (results.length === 0 && preserveBombs) return findValidPairs(hand, lastPlay, false);
  return results;
}

function findValidStraights(hand: Card[], lastPlay: import('@red10/shared').Play | null): Card[][] {
  const groups = groupByRank(hand);
  const sortedRanks = [...groups.keys()].sort((a, b) => rankValue(a) - rankValue(b));
  const results: Card[][] = [];
  const targetLen = lastPlay?.length ?? 3;

  for (let startIdx = 0; startIdx <= sortedRanks.length - targetLen; startIdx++) {
    const candidate: Card[] = [];
    for (let len = 0; len < targetLen && startIdx + len < sortedRanks.length; len++) {
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
  return results;
}

function findValidPairedStraights(hand: Card[], lastPlay: import('@red10/shared').Play | null): Card[][] {
  const groups = groupByRank(hand);
  const pairableRanks = [...groups.entries()]
    .filter(([, cards]) => cards.length >= 2)
    .sort((a, b) => rankValue(a[0]) - rankValue(b[0]));
  const results: Card[][] = [];
  const targetPairs = lastPlay ? lastPlay.length / 2 : 3;

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
  return results;
}

function findOpeningPlays(hand: Card[]): Card[][] {
  const results: Card[][] = [];
  for (const c of hand) results.push([c]);
  const groups = groupByRank(hand);
  for (const [, cards] of groups) {
    if (cards.length >= 2) results.push([cards[0], cards[1]]);
  }
  results.push(...findValidStraights(hand, null));
  results.push(...findValidPairedStraights(hand, null));
  results.push(...findBombs(hand));
  return results;
}

function findBeatingPlays(hand: Card[], lastPlay: import('@red10/shared').Play, preserveBombs = false): Card[][] {
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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sortByLowestRank(plays: Card[][]): Card[][] {
  return [...plays].sort((a, b) => {
    const aVal = Math.min(...a.map(c => rankValue(c.rank)));
    const bVal = Math.min(...b.map(c => rankValue(c.rank)));
    return aVal - bVal;
  });
}

// ---- Built-in strategies ----

const AggressiveStrategy: PlayerStrategy = {
  name: 'Aggressive',
  decideDoubling(engine, playerId) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);
    if (validActions.includes('quadruple')) return { action: 'quadruple' };
    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (bombs.length > 0) return { action: 'double', bombCards: bombs[0] };
      if (player.team === 'red10') return { action: 'double' };
    }
    return { action: 'skip' };
  },
  decidePlay(engine, playerId) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    if (validActions.includes('go_cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length >= 3) return { action: 'go_cha', cards: tc.slice(0, 3) };
    }
    if (validActions.includes('cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length === 2 || tc.length >= 4) return { action: 'cha', cards: tc.slice(0, 2) };
    }
    if (validActions.includes('decline_cha')) return { action: 'decline_cha' };
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const needed = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const bt = player.hand.filter(c => isBlackTen(c));
      if (bt.length >= needed) return { action: 'defuse', cards: bt.slice(0, needed) };
    }
    if (!validActions.includes('play')) return { action: 'pass' };

    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const bombRanks = getBombRanks(player.hand);
      const nonBomb = player.hand.filter(c => !bombRanks.has(c.rank));
      if (nonBomb.length > 0) {
        nonBomb.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        return { action: 'play', cards: [nonBomb[0]] };
      }
      const sorted = [...player.hand].sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
      return { action: 'play', cards: [sorted[0]] };
    }

    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (tc.length >= 1) return { action: 'play', cards: [tc[0]] };
        return { action: 'pass' };
      }
      const bp = findBeatingPlays(player.hand, round.lastPlay, true);
      if (bp.length > 0) return { action: 'play', cards: sortByLowestRank(bp)[0] };
    }

    if (round && round.currentFormat === null) {
      const op = findOpeningPlays(player.hand);
      if (op.length > 0) return { action: 'play', cards: sortByLowestRank(op)[0] };
    }

    return { action: 'pass' };
  },
};

const SmartRacerStrategy: PlayerStrategy = {
  name: 'SmartRacer',
  decideDoubling(engine, playerId) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);
    if (validActions.includes('quadruple')) {
      const bombs = findBombs(player.hand);
      if (bombs.length >= 2) return { action: 'quadruple' };
      return { action: 'skip_quadruple' };
    }
    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      const groups = groupByRank(player.hand);
      if (bombs.length >= 2 || (bombs.length >= 1 && groups.size <= 5)) {
        if (player.team === 'red10') return { action: 'double' };
        if (bombs.length > 0) return { action: 'double', bombCards: bombs[0] };
      }
    }
    return { action: 'skip' };
  },
  decidePlay(engine, playerId) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    if (validActions.includes('go_cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length >= 3) return { action: 'go_cha', cards: tc.slice(0, 3) };
    }
    if (validActions.includes('cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length === 2 || tc.length >= 4) return { action: 'cha', cards: tc.slice(0, 2) };
      if (tc.length === 3) return { action: 'go_cha', cards: tc.slice(0, 3) };
    }
    if (validActions.includes('decline_cha')) return { action: 'decline_cha' };
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const needed = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const bt = player.hand.filter(c => isBlackTen(c));
      if (bt.length >= needed) return { action: 'defuse', cards: bt.slice(0, needed) };
    }
    if (!validActions.includes('play')) return { action: 'pass' };

    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const straights = findValidStraights(player.hand, null);
      const bombs = findBombs(player.hand);
      if (straights.length > 0 && bombs.length > 0) {
        const sorted = [...straights].sort((a, b) => b.length - a.length);
        return { action: 'play', cards: sorted[0] };
      }
      const ps = findValidPairedStraights(player.hand, null);
      if (ps.length > 0) {
        const sorted = [...ps].sort((a, b) => b.length - a.length);
        return { action: 'play', cards: sorted[0] };
      }
      const pairs = findValidPairs(player.hand, null, true);
      if (pairs.length > 0) return { action: 'play', cards: sortByLowestRank(pairs)[0] };
      const singles = findValidSingles(player.hand, null, true);
      if (singles.length > 0) return { action: 'play', cards: sortByLowestRank(singles)[0] };
      return { action: 'play', cards: [player.hand[0]] };
    }

    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (tc.length >= 1) return { action: 'play', cards: [tc[0]] };
        return { action: 'pass' };
      }
      const bp = findBeatingPlays(player.hand, round.lastPlay, true);
      if (bp.length > 0) return { action: 'play', cards: sortByLowestRank(bp)[0] };
    }

    return { action: 'pass' };
  },
};

const HandSizeExploiterStrategy: PlayerStrategy = {
  name: 'HandSizeExploiter',
  decideDoubling(engine, playerId) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);
    if (validActions.includes('quadruple')) return { action: 'quadruple' };
    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (player.team === 'red10') return { action: 'double' };
      if (bombs.length > 0) return { action: 'double', bombCards: bombs[0] };
    }
    return { action: 'skip' };
  },
  decidePlay(engine, playerId) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    if (validActions.includes('go_cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length >= 3) return { action: 'go_cha', cards: tc.slice(0, 3) };
    }
    if (validActions.includes('cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length === 2 || tc.length >= 4) return { action: 'cha', cards: tc.slice(0, 2) };
    }
    if (validActions.includes('decline_cha')) return { action: 'decline_cha' };
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const needed = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const bt = player.hand.filter(c => isBlackTen(c));
      if (bt.length >= needed) return { action: 'defuse', cards: bt.slice(0, needed) };
    }
    if (!validActions.includes('play')) return { action: 'pass' };

    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const op = findOpeningPlays(player.hand);
      const multiCard = op.filter(p => p.length >= 2);
      if (multiCard.length > 0) {
        multiCard.sort((a, b) => b.length - a.length);
        return { action: 'play', cards: multiCard[0] };
      }
      const singles = findValidSingles(player.hand, null, true);
      if (singles.length > 0) return { action: 'play', cards: sortByLowestRank(singles)[0] };
      return { action: 'play', cards: [player.hand[0]] };
    }

    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (tc.length >= 1) return { action: 'play', cards: [tc[0]] };
        return { action: 'pass' };
      }
      const bp = findBeatingPlays(player.hand, round.lastPlay, true);
      if (bp.length > 0) return { action: 'play', cards: sortByLowestRank(bp)[0] };
    }

    if (round && round.currentFormat === null) return { action: 'play', cards: [player.hand[0]] };

    return { action: 'pass' };
  },
};

const TeamCoordinatorStrategy: PlayerStrategy = {
  name: 'TeamCoordinator',
  decideDoubling(engine, playerId) {
    const state = engine.getState();
    const player = state.players.find(p => p.id === playerId)!;
    const validActions = engine.getValidActions(playerId);
    if (validActions.includes('quadruple')) {
      const bombs = findBombs(player.hand);
      if (bombs.some(b => b.length >= 4)) return { action: 'quadruple' };
      return { action: 'skip_quadruple' };
    }
    if (validActions.includes('double')) {
      const bombs = findBombs(player.hand);
      if (player.team === 'red10' && bombs.length >= 1) return { action: 'double' };
      if (player.team === 'black10' && bombs.length > 0) {
        const sorted = [...bombs].sort((a, b) => a.length - b.length);
        return { action: 'double', bombCards: sorted[0] };
      }
    }
    return { action: 'skip' };
  },
  decidePlay(engine, playerId) {
    // Same as SmartRacer for simplicity
    return SmartRacerStrategy.decidePlay(engine, playerId);
  },
};

const RandomStrategy: PlayerStrategy = {
  name: 'Random',
  decideDoubling() {
    return { action: 'skip' };
  },
  decidePlay(engine, playerId) {
    const state = engine.getState();
    const validActions = engine.getValidActions(playerId);
    const player = state.players.find(p => p.id === playerId)!;
    const round = state.round;

    if (validActions.includes('go_cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length >= 3 && Math.random() < 0.5) return { action: 'go_cha', cards: tc.slice(0, 3) };
    }
    if (validActions.includes('cha') && round?.chaGoState) {
      const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
      if (tc.length >= 2 && Math.random() < 0.5) return { action: 'cha', cards: tc.slice(0, 2) };
    }
    if (validActions.includes('decline_cha')) return { action: 'decline_cha' };
    if (validActions.includes('defuse') && round?.lastPlay?.specialBomb) {
      const needed = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const bt = player.hand.filter(c => isBlackTen(c));
      if (bt.length >= needed && Math.random() < 0.3) return { action: 'defuse', cards: bt.slice(0, needed) };
    }
    if (!validActions.includes('play')) return { action: 'pass' };

    if (round && round.currentFormat === null && round.leaderId === playerId) {
      const op = findOpeningPlays(player.hand);
      if (op.length > 0) return { action: 'play', cards: pickRandom(op) };
      return { action: 'play', cards: [player.hand[0]] };
    }

    if (round?.lastPlay) {
      if (round.chaGoState?.phase === 'waiting_go') {
        const tc = player.hand.filter(c => c.rank === round.chaGoState!.triggerRank);
        if (tc.length >= 1 && Math.random() < 0.5) return { action: 'play', cards: [tc[0]] };
        return { action: 'pass' };
      }
      if (Math.random() < 0.5) {
        const bp = findBeatingPlays(player.hand, round.lastPlay);
        if (bp.length > 0) return { action: 'play', cards: pickRandom(bp) };
      }
      if (validActions.includes('pass')) return { action: 'pass' };
    }

    if (round && round.currentFormat === null) {
      const op = findOpeningPlays(player.hand);
      if (op.length > 0) return { action: 'play', cards: pickRandom(op) };
    }

    return { action: 'pass' };
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
  RandomStrategy,
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
  | { action: 'quadruple' }
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
