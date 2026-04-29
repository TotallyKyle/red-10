import type { GameEngine } from '../game/GameEngine.js';
import type { Card } from '@red10/shared';
import { SUIT_DISPLAY, RANK_ORDER } from '@red10/shared';

// ---- Types ----

export interface GameLogEntry {
  timestamp: number;
  roundNumber: number;
  phase: string;
  actor: string;
  actorTeam: string;
  action: string;
  detail: string;
  cards?: string[];
  handSizes: Record<string, number>;
  roundFormat?: string;
  chaGoState?: string;
}

// ---- Helpers ----

function cardToString(card: Card): string {
  const suitSymbol = SUIT_DISPLAY[card.suit] ?? card.suit;
  return `${card.rank}${suitSymbol}`;
}

function sortCardsByRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
}

function cardsToString(cards: Card[]): string {
  return sortCardsByRank(cards).map(cardToString).join(' ');
}

function formatPlayDescription(cards: Card[], format?: string): string {
  if (!cards || cards.length === 0) return '';

  if (format === 'bomb' || (cards.length >= 3 && cards.every(c => c.rank === cards[0].rank))) {
    if (cards.length >= 3 && cards.every(c => c.rank === cards[0].rank)) {
      return `${cards[0].rank}\u00d7${cards.length}`;
    }
    // Special bombs
    const red10s = cards.filter(c => c.rank === '10' && c.isRed);
    if (red10s.length >= 2) return `Red10\u00d7${red10s.length}`;
    return cardsToString(cards);
  }

  if (cards.length === 1) return `${cardToString(cards[0])} (single)`;
  if (cards.length === 2 && cards[0].rank === cards[1].rank) return `${cardToString(cards[0])} ${cardToString(cards[1])} (pair)`;

  const fmt = format ?? 'cards';
  return `${cardsToString(cards)} (${fmt})`;
}

function getHandSizes(engine: GameEngine): Record<string, number> {
  const state = engine.getState();
  // Sort by seat index (clockwise order) before building the record
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const sizes: Record<string, number> = {};
  for (const p of sorted) {
    sizes[p.name] = p.handSize;
  }
  return sizes;
}

function handSizesCompact(engine: GameEngine): string {
  const state = engine.getState();
  return [...state.players]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map(p => `${p.name.charAt(0)}:${p.handSize}`)
    .join(' ');
}

function getPlayerName(engine: GameEngine, playerId: string): string {
  const state = engine.getState();
  const player = state.players.find(p => p.id === playerId);
  return player?.name ?? playerId;
}

function getPlayerTeam(engine: GameEngine, playerId: string): string {
  const state = engine.getState();
  const player = state.players.find(p => p.id === playerId);
  return player?.team ?? 'unknown';
}

// ---- GameLogger ----

export class GameLogger {
  private log: GameLogEntry[] = [];
  private roundNumber = 0;
  private teamInfo: { red10: string[]; black10: string[] } = { red10: [], black10: [] };

  logAction(engine: GameEngine, actorId: string, action: string, cards?: Card[]): void {
    const actorName = getPlayerName(engine, actorId);
    const actorTeam = getPlayerTeam(engine, actorId);
    const state = engine.getState();

    let detail = '';
    const cardStrs = cards ? cards.map(cardToString) : undefined;

    switch (action) {
      case 'play': {
        const round = state.round;
        const format = round?.plays?.[round.plays.length - 1]?.format
          ?? round?.currentFormat
          ?? 'single';
        const isOpening = round?.plays?.length === 1 && round.leaderId === actorId;
        const verb = isOpening ? 'opened with' : 'played';
        detail = `${verb} ${formatPlayDescription(cards ?? [], format)}`;
        break;
      }
      case 'pass':
        detail = 'passed';
        break;
      case 'cha':
        detail = `CHA'd with ${formatPlayDescription(cards ?? [], 'pair')}`;
        break;
      case 'go_cha':
        detail = `GO-CHA'd with ${formatPlayDescription(cards ?? [], 'bomb')}`;
        break;
      case 'decline_cha':
        detail = 'declined cha';
        break;
      case 'defuse':
        detail = `DEFUSED with ${cardsToString(cards ?? [])}`;
        break;
      default:
        detail = `${action}${cards ? ': ' + cardsToString(cards) : ''}`;
    }

    this.log.push({
      timestamp: Date.now(),
      roundNumber: this.roundNumber,
      phase: state.phase,
      actor: actorName,
      actorTeam,
      action,
      detail,
      cards: cardStrs,
      handSizes: getHandSizes(engine),
      roundFormat: state.round?.currentFormat ?? undefined,
      chaGoState: state.round?.chaGoState
        ? `${state.round.chaGoState.phase} on ${state.round.chaGoState.triggerRank}s`
        : undefined,
    });

    if (cards && cards.some(c => c.rank === '10' && c.isRed)) {
      const player = state.players.find(p => p.id === actorId);
      if (player) {
        this.log.push({
          timestamp: Date.now(),
          roundNumber: this.roundNumber,
          phase: 'playing',
          actor: 'System',
          actorTeam: '',
          action: 'team_revealed',
          detail: `Team revealed: ${actorName} is on Red10`,
          handSizes: getHandSizes(engine),
        });
      }
    }
  }

  logDoubling(engine: GameEngine, actorId: string, action: string, cards?: Card[]): void {
    const actorName = getPlayerName(engine, actorId);
    const actorTeam = getPlayerTeam(engine, actorId);

    let detail = '';
    switch (action) {
      case 'double':
        detail = cards && cards.length > 0
          ? `DOUBLED (revealed: ${cardsToString(cards)})`
          : 'DOUBLED';
        break;
      case 'skip':
        detail = 'skipped doubling';
        break;
      case 'quadruple':
        detail = 'QUADRUPLED!';
        break;
      case 'skip_quadruple':
        detail = 'skipped quadruple';
        break;
      default:
        detail = action;
    }

    // Check if teams were just revealed
    const state = engine.getState();
    if (state.doubling?.teamsRevealed && action === 'double') {
      detail += ' \u2192 Teams revealed!';
    }

    this.log.push({
      timestamp: Date.now(),
      roundNumber: 0,
      phase: 'doubling',
      actor: actorName,
      actorTeam,
      action,
      detail,
      cards: cards?.map(cardToString),
      handSizes: getHandSizes(engine),
    });
  }

  logRoundStart(engine: GameEngine, leaderId: string): void {
    this.roundNumber++;
    const leaderName = getPlayerName(engine, leaderId);

    this.log.push({
      timestamp: Date.now(),
      roundNumber: this.roundNumber,
      phase: 'playing',
      actor: leaderName,
      actorTeam: getPlayerTeam(engine, leaderId),
      action: 'round_start',
      detail: `Round ${this.roundNumber} started`,
      handSizes: getHandSizes(engine),
    });
  }

  logRoundEnd(engine: GameEngine, winnerId: string): void {
    const winnerName = getPlayerName(engine, winnerId);

    this.log.push({
      timestamp: Date.now(),
      roundNumber: this.roundNumber,
      phase: 'playing',
      actor: winnerName,
      actorTeam: getPlayerTeam(engine, winnerId),
      action: 'round_end',
      detail: `wins the round! (everyone passed)`,
      handSizes: getHandSizes(engine),
    });
  }

  logGameEnd(engine: GameEngine): void {
    const state = engine.getState();
    const result = engine.getGameResult();
    if (!result) return;

    const scoringTeamName = result.scoringTeam === 'red10' ? 'Red10' : 'Black10';
    const won = result.scoringTeamWon;

    this.log.push({
      timestamp: Date.now(),
      roundNumber: this.roundNumber,
      phase: 'game_over',
      actor: 'System',
      actorTeam: '',
      action: 'game_over',
      detail: `GAME OVER - ${scoringTeamName} ${won ? 'WINS' : 'LOSES'}! Trapped: ${result.trapped.length} players`,
      handSizes: getHandSizes(engine),
    });

    // Store team info for formatted output
    this.teamInfo = { red10: [], black10: [] };
    for (const p of state.players) {
      if (p.team === 'red10') this.teamInfo.red10.push(p.name);
      else this.teamInfo.black10.push(p.name);
    }
  }

  /**
   * Get formatted log as a readable text string.
   */
  getFormattedLog(): string {
    const lines: string[] = [];
    lines.push('=== Red 10 Game Log ===');

    if (this.teamInfo.red10.length > 0 || this.teamInfo.black10.length > 0) {
      lines.push(`Teams: Red10 [${this.teamInfo.red10.join(', ')}] vs Black10 [${this.teamInfo.black10.join(', ')}]`);
    }
    lines.push('');

    let currentRound = -1;
    let inDoubling = false;

    for (const entry of this.log) {
      if (entry.phase === 'doubling' && !inDoubling) {
        lines.push('--- Doubling Phase ---');
        inDoubling = true;
      }

      if (entry.phase === 'playing' && inDoubling) {
        inDoubling = false;
        lines.push('');
      }

      if (entry.action === 'round_start' && entry.roundNumber !== currentRound) {
        currentRound = entry.roundNumber;
        lines.push(`--- Round ${currentRound} (Leader: ${entry.actor}) ---`);
        continue;
      }

      if (entry.action === 'round_end') {
        lines.push(`[${entry.actor}] ${entry.detail}`);
        lines.push('');
        continue;
      }

      if (entry.action === 'game_over') {
        lines.push('');
        lines.push(`=== ${entry.detail} ===`);
        continue;
      }

      // Build hand sizes display
      const handParts: string[] = [];
      for (const [name, size] of Object.entries(entry.handSizes)) {
        handParts.push(`${name.charAt(0)}:${size}`);
      }
      const handStr = handParts.length > 0 ? ` | Hands: ${handParts.join(' ')}` : '';

      lines.push(`[${entry.actor}] ${entry.detail}${handStr}`);

      if (entry.chaGoState) {
        lines.push(`  \u2192 Cha-go: ${entry.chaGoState}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get raw entries for client display.
   */
  getEntries(): GameLogEntry[] {
    return [...this.log];
  }

  /**
   * Get a simplified entry for broadcasting to clients.
   */
  getLastEntryForBroadcast(): { actor: string; detail: string; handSizes: Record<string, number> } | null {
    if (this.log.length === 0) return null;
    const last = this.log[this.log.length - 1];
    return {
      actor: last.actor,
      detail: last.detail,
      handSizes: last.handSizes,
    };
  }

  /**
   * Clear log for a new game.
   */
  clear(): void {
    this.log = [];
    this.roundNumber = 0;
    this.teamInfo = { red10: [], black10: [] };
  }
}
