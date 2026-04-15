import { GameEngine } from '../../src/game/GameEngine.js';
import type { PlayerStrategy } from './strategies.js';
import type { ActionLogEntry, InvariantViolation } from './invariants.js';
import { checkInvariants } from './invariants.js';
import type { Card, ActionType } from '@red10/shared';
import { classifyBomb, isBlackTen } from '@red10/shared';

export interface SimulationConfig {
  numGames: number;
  strategies: PlayerStrategy[];
  seed?: number;
  verbose?: boolean;
}

export interface SimulationResult {
  gamesPlayed: number;
  gamesCompleted: number;
  gamesFailed: number;
  violations: InvariantViolation[];
  errors: { game: number; error: string; actionLog: ActionLogEntry[] }[];
  stats: {
    avgRoundsPerGame: number;
    avgActionsPerGame: number;
    red10Wins: number;
    black10Wins: number;
    scoringTeamFailures: number;
    doublesOccurred: number;
    chaGosOccurred: number;
    defusesOccurred: number;
    bombsPlayed: number;
  };
}

const MAX_ACTIONS_PER_GAME = 1000;
const MAX_RETRIES_PER_ACTION = 5;

function makePlayers() {
  return [
    { id: 'p0', name: 'Alice', seatIndex: 0 },
    { id: 'p1', name: 'Bob', seatIndex: 1 },
    { id: 'p2', name: 'Charlie', seatIndex: 2 },
    { id: 'p3', name: 'Dave', seatIndex: 3 },
    { id: 'p4', name: 'Eve', seatIndex: 4 },
    { id: 'p5', name: 'Frank', seatIndex: 5 },
  ];
}

const PLAYER_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];

export class GameSimulator {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    if (config.strategies.length !== 6) {
      throw new Error('Must provide exactly 6 strategies');
    }
    this.config = config;
  }

  run(): SimulationResult {
    const result: SimulationResult = {
      gamesPlayed: 0,
      gamesCompleted: 0,
      gamesFailed: 0,
      violations: [],
      errors: [],
      stats: {
        avgRoundsPerGame: 0,
        avgActionsPerGame: 0,
        red10Wins: 0,
        black10Wins: 0,
        scoringTeamFailures: 0,
        doublesOccurred: 0,
        chaGosOccurred: 0,
        defusesOccurred: 0,
        bombsPlayed: 0,
      },
    };

    let totalRounds = 0;
    let totalActions = 0;

    for (let i = 0; i < this.config.numGames; i++) {
      result.gamesPlayed++;
      const gameResult = this.runSingleGame(i);

      totalActions += gameResult.actionLog.length;
      totalRounds += gameResult.roundCount;

      if (gameResult.violations.length > 0) {
        result.violations.push(...gameResult.violations);
        result.gamesFailed++;
      }

      if (gameResult.error) {
        result.errors.push({
          game: i,
          error: gameResult.error,
          actionLog: gameResult.actionLog,
        });
        result.gamesFailed++;
      }

      if (gameResult.completed) {
        result.gamesCompleted++;
      }

      // Accumulate stats
      result.stats.doublesOccurred += gameResult.stats.doublesOccurred;
      result.stats.chaGosOccurred += gameResult.stats.chaGosOccurred;
      result.stats.defusesOccurred += gameResult.stats.defusesOccurred;
      result.stats.bombsPlayed += gameResult.stats.bombsPlayed;
      result.stats.red10Wins += gameResult.stats.red10Wins;
      result.stats.black10Wins += gameResult.stats.black10Wins;
      result.stats.scoringTeamFailures += gameResult.stats.scoringTeamFailures;
    }

    if (result.gamesCompleted > 0) {
      result.stats.avgRoundsPerGame = totalRounds / result.gamesCompleted;
      result.stats.avgActionsPerGame = totalActions / result.gamesCompleted;
    }

    return result;
  }

  private runSingleGame(gameIndex: number): {
    actionLog: ActionLogEntry[];
    completed: boolean;
    error?: string;
    violations: InvariantViolation[];
    roundCount: number;
    stats: {
      doublesOccurred: number;
      chaGosOccurred: number;
      defusesOccurred: number;
      bombsPlayed: number;
      red10Wins: number;
      black10Wins: number;
      scoringTeamFailures: number;
    };
  } {
    const engine = new GameEngine('sim-game', makePlayers());
    engine.startGame();

    const actionLog: ActionLogEntry[] = [];
    const playedCardIds = new Set<string>();
    const allViolations: InvariantViolation[] = [];
    let actionIndex = 0;
    let roundCount = 0;
    const stats = {
      doublesOccurred: 0,
      chaGosOccurred: 0,
      defusesOccurred: 0,
      bombsPlayed: 0,
      red10Wins: 0,
      black10Wins: 0,
      scoringTeamFailures: 0,
    };

    const verbose = this.config.verbose ?? false;

    try {
      // ---- Doubling Phase ----
      let state = engine.getState();
      while (state.phase === 'doubling' && actionIndex < MAX_ACTIONS_PER_GAME) {
        const doubling = state.doubling!;
        const bidderId = doubling.currentBidderId;
        if (!bidderId) break;

        const playerIdx = PLAYER_IDS.indexOf(bidderId);
        if (playerIdx === -1) break;

        const strategy = this.config.strategies[playerIdx];
        const validActions = engine.getValidActions(bidderId);

        if (validActions.length === 0) break;

        const decision = strategy.decideDoubling(engine, bidderId);
        let result: { success: boolean; error?: string };

        if (decision.action === 'double' && validActions.includes('double')) {
          result = engine.declareDouble(bidderId, decision.bombCards);
          if (result.success) stats.doublesOccurred++;
        } else if (decision.action === 'quadruple' && validActions.includes('quadruple')) {
          result = engine.declareQuadruple(bidderId);
        } else {
          // skip
          if (validActions.includes('skip_double')) {
            if (doubling.isDoubled) {
              result = engine.skipQuadruple(bidderId);
            } else {
              result = engine.skipDouble(bidderId);
            }
          } else {
            result = { success: false, error: 'No valid action available' };
          }
        }

        const entry: ActionLogEntry = {
          actionIndex: actionIndex++,
          playerId: bidderId,
          action: decision.action,
          result,
          roundNumber: 0,
          phase: 'doubling',
        };
        actionLog.push(entry);

        if (verbose) {
          console.log(`[G${gameIndex}] Doubling: ${bidderId} -> ${decision.action} (${result.success ? 'OK' : result.error})`);
        }

        // Check invariants
        const violations = checkInvariants(engine, actionLog, playedCardIds);
        if (violations.length > 0) {
          allViolations.push(...violations);
        }

        state = engine.getState();
      }

      // ---- Playing Phase ----
      let lastRoundLeader = '';
      while (state.phase === 'playing' && actionIndex < MAX_ACTIONS_PER_GAME) {
        const round = state.round;
        if (!round) break;

        // Track round changes
        if (round.leaderId !== lastRoundLeader) {
          roundCount++;
          lastRoundLeader = round.leaderId;
        }

        // Find who needs to act
        const actingPlayerId = this.findActingPlayer(engine, state);
        if (!actingPlayerId) {
          // No one can act - this shouldn't happen during playing phase
          break;
        }

        const playerIdx = PLAYER_IDS.indexOf(actingPlayerId);
        if (playerIdx === -1) break;

        const strategy = this.config.strategies[playerIdx];
        const decision = strategy.decidePlay(engine, actingPlayerId);

        let result: { success: boolean; error?: string };
        let retries = 0;

        // Execute the decision with retries
        while (retries < MAX_RETRIES_PER_ACTION) {
          result = this.executeDecision(engine, actingPlayerId, decision);

          if (result.success) {
            // Track played cards
            if (decision.action === 'play' || decision.action === 'cha' || decision.action === 'go_cha' || decision.action === 'defuse') {
              const cards = (decision as { cards: Card[] }).cards;
              if (cards) {
                for (const c of cards) {
                  playedCardIds.add(c.id);
                }
              }
              // Track stats
              if (decision.action === 'defuse') stats.defusesOccurred++;
              if (decision.action === 'cha' || decision.action === 'go_cha') stats.chaGosOccurred++;
              if (decision.action === 'play' && cards) {
                const bomb = classifyBomb(cards);
                if (bomb) stats.bombsPlayed++;
              }
            }
            break;
          }

          retries++;

          // If the action failed, try a fallback
          if (retries < MAX_RETRIES_PER_ACTION) {
            const validActions = engine.getValidActions(actingPlayerId);

            if (validActions.includes('pass')) {
              result = engine.pass(actingPlayerId);
              if (result.success) {
                // Override decision for logging
                (decision as any).action = 'pass';
                (decision as any).cards = undefined;
                break;
              }
            }

            if (validActions.includes('decline_cha')) {
              result = engine.declineCha(actingPlayerId);
              if (result.success) {
                (decision as any).action = 'decline_cha';
                (decision as any).cards = undefined;
                break;
              }
            }

            // Try playing any single card
            if (validActions.includes('play')) {
              const player = state.players.find(p => p.id === actingPlayerId);
              if (player && player.hand.length > 0) {
                result = engine.playCards(actingPlayerId, [player.hand[0]]);
                if (result.success) {
                  playedCardIds.add(player.hand[0].id);
                  (decision as any).action = 'play';
                  (decision as any).cards = [player.hand[0]];
                  break;
                }
              }
            }
          }
        }

        const entry: ActionLogEntry = {
          actionIndex: actionIndex++,
          playerId: actingPlayerId,
          action: decision.action,
          cards: 'cards' in decision ? (decision as any).cards : undefined,
          result: result!,
          roundNumber: roundCount,
          phase: 'playing',
          chaGoState: round.chaGoState ? { ...round.chaGoState } : undefined,
        };
        actionLog.push(entry);

        if (verbose) {
          const cardStr = 'cards' in decision && (decision as any).cards
            ? (decision as any).cards.map((c: Card) => c.id).join(',')
            : '';
          console.log(`[G${gameIndex}] Play: ${actingPlayerId} -> ${decision.action} ${cardStr} (${result!.success ? 'OK' : result!.error})`);
        }

        // Check invariants after every action
        const violations = checkInvariants(engine, actionLog, playedCardIds);
        if (violations.length > 0) {
          allViolations.push(...violations);
          if (verbose) {
            for (const v of violations) {
              console.log(`  VIOLATION: [${v.invariant}] ${v.message}`);
            }
          }
        }

        state = engine.getState();
      }

      // ---- Game Over ----
      if (state.phase === 'game_over') {
        const gameResult = engine.getGameResult();
        if (gameResult) {
          if (gameResult.scoringTeamWon) {
            if (gameResult.scoringTeam === 'red10') stats.red10Wins++;
            else stats.black10Wins++;
          } else {
            stats.scoringTeamFailures++;
          }
        }

        // Final invariant check
        const violations = checkInvariants(engine, actionLog, playedCardIds);
        if (violations.length > 0) {
          allViolations.push(...violations);
        }

        return {
          actionLog,
          completed: true,
          violations: allViolations,
          roundCount,
          stats,
        };
      }

      if (actionIndex >= MAX_ACTIONS_PER_GAME) {
        return {
          actionLog,
          completed: false,
          error: `Game exceeded max actions limit (${MAX_ACTIONS_PER_GAME})`,
          violations: allViolations,
          roundCount,
          stats,
        };
      }

      return {
        actionLog,
        completed: false,
        error: `Game ended in unexpected state: phase=${state.phase}`,
        violations: allViolations,
        roundCount,
        stats,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        actionLog,
        completed: false,
        error: `Exception: ${message}`,
        violations: allViolations,
        roundCount,
        stats,
      };
    }
  }

  /**
   * Find which player needs to act right now.
   * During cha-go waiting_cha/waiting_final_cha, multiple players may be eligible.
   * We pick the first eligible one who hasn't declined.
   */
  private findActingPlayer(engine: GameEngine, state: any): string | null {
    const round = state.round;
    if (!round) return null;

    const cg = round.chaGoState;

    if (cg && (cg.phase === 'waiting_cha' || cg.phase === 'waiting_final_cha')) {
      // Find first eligible player who hasn't declined
      for (const pid of cg.eligiblePlayerIds) {
        if (!cg.declinedPlayerIds.includes(pid)) {
          const validActions = engine.getValidActions(pid);
          if (validActions.length > 0) {
            return pid;
          }
        }
      }
      return null;
    }

    // Check if any player can defuse (interrupt)
    if (round.lastPlay?.specialBomb === 'red10_2' || round.lastPlay?.specialBomb === 'red10_3') {
      for (const pid of PLAYER_IDS) {
        const validActions = engine.getValidActions(pid);
        if (validActions.includes('defuse')) {
          // Let the defuse-capable player act if they want to
          // But also let the current player have priority
          if (pid === round.currentPlayerId) return pid;
        }
      }
      // Check non-current players for defuse
      for (const pid of PLAYER_IDS) {
        if (pid === round.currentPlayerId) continue;
        const validActions = engine.getValidActions(pid);
        if (validActions.includes('defuse')) {
          return pid;
        }
      }
    }

    // Normal case: current player
    return round.currentPlayerId;
  }

  private executeDecision(
    engine: GameEngine,
    playerId: string,
    decision: ReturnType<PlayerStrategy['decidePlay']>,
  ): { success: boolean; error?: string } {
    switch (decision.action) {
      case 'play':
        return engine.playCards(playerId, decision.cards);
      case 'pass':
        return engine.pass(playerId);
      case 'cha':
        return engine.cha(playerId, decision.cards);
      case 'go_cha':
        return engine.goCha(playerId, decision.cards);
      case 'decline_cha':
        return engine.declineCha(playerId);
      case 'defuse':
        return engine.defuse(playerId, decision.cards);
      default:
        return { success: false, error: `Unknown action: ${(decision as any).action}` };
    }
  }
}
