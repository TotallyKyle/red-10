/**
 * Strategy Evolver — runs games, analyzes decisions, and reports anti-patterns.
 *
 * This produces a structured report of "bad decisions" that a reviewer can use
 * to improve the bot strategy code.
 */
import { GameEngine } from '../../src/game/GameEngine.js';
import { findBeatingPlays } from '../../src/bot/BotManager.js';
import type { Card, Play, GameState, RoundInfo } from '@red10/shared';
import { RANK_ORDER, classifyBomb, detectFormat, canBeat } from '@red10/shared';

// Re-use the simulator's strategy imports
import type { PlayerStrategy } from '../../src/bot/BotManager.js';

const PLAYER_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
const PLAYER_NAMES = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank'];

function rv(rank: string): number {
  return RANK_ORDER[rank];
}

// ---- Decision Record ----

export interface DecisionRecord {
  gameIndex: number;
  roundNumber: number;
  playerId: string;
  playerName: string;
  playerTeam: string;
  handSize: number;
  hand: string[];          // card descriptions
  action: string;          // 'play', 'pass', 'bomb', etc.
  cardsPlayed?: string[];  // what was played
  context: {
    currentFormat: string | null;
    lastPlayRank: number | null;
    lastPlayFormat: string | null;
    lastPlayerId: string | null;
    lastPlayerTeam: string | null;
    opponentMinHand: number;
    teammateMinHand: number;
    chaGoPhase: string | null;
  };
  alternatives: string[];    // what else could have been played
  flags: string[];           // anti-pattern flags
}

export interface GameAnalysis {
  gameIndex: number;
  winner: string;
  scoringTeam: string;
  scoringTeamWon: boolean;
  trapped: string[];
  finishOrder: string[];
  decisions: DecisionRecord[];
  endHandSizes: Record<string, number>;
  totalRounds: number;
}

export interface EvolutionReport {
  gamesAnalyzed: number;
  metrics: {
    avgTrapped: number;
    avgRounds: number;
    scoringTeamWinRate: number;
    avgEndHandSizeTrapped: number;
    bombsUsedOnNonBombs: number;
    highCardsWasted: number;
    bombsHeldAtEnd: number;
    passedWhenCouldBlock: number;
    playedOverTeammate: number;
    failedToBlockLowHandOpponent: number;
  };
  worstDecisions: DecisionRecord[];
  antiPatternCounts: Record<string, number>;
}

// ---- Evolver ----

export class StrategyEvolver {
  private strategies: PlayerStrategy[];

  constructor(strategies: PlayerStrategy[]) {
    this.strategies = strategies;
  }

  /**
   * Run N games and produce a full analysis report.
   */
  analyze(numGames: number): EvolutionReport {
    const allAnalyses: GameAnalysis[] = [];
    let failCount = 0;

    for (let i = 0; i < numGames; i++) {
      try {
        const analysis = this.runAndAnalyze(i);
        if (analysis) {
          allAnalyses.push(analysis);
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
        if (failCount <= 3) {
          console.error(`Game ${i} failed:`, e instanceof Error ? e.message : e);
        }
      }
    }

    const report = this.summarize(allAnalyses);
    // Inject completion rate
    (report as any).completionRate = `${allAnalyses.length}/${numGames} (${failCount} failed)`;
    return report;
  }

  private runAndAnalyze(gameIndex: number): GameAnalysis | null {
    const players = PLAYER_IDS.map((id, i) => ({
      id,
      name: PLAYER_NAMES[i],
      seatIndex: i,
    }));

    const engine = new GameEngine('evo-game', players);
    engine.startGame();

    // Skip doubling phase — focus analysis on play decisions
    let skipIter = 0;
    while (engine.getState().phase === 'doubling' && skipIter < 20) {
      skipIter++;
      const ds = engine.getState();
      const doubling = ds.doubling;
      if (!doubling?.currentBidderId) break;
      const bidderId = doubling.currentBidderId;
      const va = engine.getValidActions(bidderId);
      if (va.length === 0) break;
      if (va.includes('skip_double')) {
        if (doubling.isDoubled) {
          engine.skipQuadruple(bidderId);
        } else {
          engine.skipDouble(bidderId);
        }
      } else {
        break;
      }
    }

    const decisions: DecisionRecord[] = [];
    let roundNumber = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 2000;
    let consecutivePasses = 0;

    while (engine.getState().phase === 'playing' && iterations < MAX_ITERATIONS) {
      iterations++;
      const st = engine.getState();
      const round = st.round;
      if (!round) break;

      if (round.plays.length === 0) roundNumber++;

      // Find who needs to act — check all players for interrupt actions (cha, defuse)
      // then fall back to the current player
      let currentId: string | null = null;
      for (const pid of PLAYER_IDS) {
        const va = engine.getValidActions(pid);
        if (va.length > 0 && (va.includes('cha') || va.includes('go_cha') || va.includes('decline_cha') || va.includes('defuse'))) {
          currentId = pid;
          break;
        }
      }
      if (!currentId) {
        currentId = round.currentPlayerId;
      }

      const player = st.players.find(p => p.id === currentId);
      if (!player || player.isOut) break;

      const strategyIdx = PLAYER_IDS.indexOf(currentId);
      const strategy = this.strategies[strategyIdx % this.strategies.length];
      const validActions = engine.getValidActions(currentId);

      if (validActions.length === 0) break;

      // Capture context BEFORE the decision
      const opponents = st.players.filter(
        p => !p.isOut && p.id !== currentId && p.team !== player.team,
      );
      const teammates = st.players.filter(
        p => !p.isOut && p.id !== currentId && p.team === player.team,
      );
      const opponentMinHand = opponents.length > 0
        ? Math.min(...opponents.map(p => p.handSize))
        : 99;
      const teammateMinHand = teammates.length > 0
        ? Math.min(...teammates.map(p => p.handSize))
        : 99;

      const context = {
        currentFormat: round.currentFormat,
        lastPlayRank: round.lastPlay
          ? Math.max(...round.lastPlay.cards.map(c => rv(c.rank)))
          : null,
        lastPlayFormat: round.lastPlay?.format ?? null,
        lastPlayerId: round.lastPlay?.playerId ?? null,
        lastPlayerTeam: round.lastPlay
          ? (st.players.find(p => p.id === round.lastPlay!.playerId)?.team ?? null)
          : null,
        opponentMinHand,
        teammateMinHand,
        chaGoPhase: round.chaGoState?.phase ?? null,
      };

      // Get the decision
      const decision = strategy.decidePlay(engine, currentId);

      // Calculate alternatives
      const alternatives = this.findAlternatives(player.hand, round);

      // Execute the decision
      const flags: string[] = [];
      let cardsPlayed: string[] | undefined;

      // Track consecutive passes to detect stuck games
      if (decision.action === 'pass') {
        consecutivePasses++;
      } else {
        consecutivePasses = 0;
      }
      // If everyone passes many times in a row, game is stuck
      if (consecutivePasses > 30) break;

      // If bot tries to pass as leader with no format set, force a play
      if (decision.action === 'pass' && round.currentFormat === null && round.leaderId === currentId) {
        // Leader MUST play — pick lowest card
        const sorted = [...player.hand].sort((a, b) => rv(a.rank) - rv(b.rank));
        const result = engine.playCards(currentId, [sorted[0]]);
        if (!result.success) { engine.pass(currentId); }
        continue;
      }

      if (decision.action === 'play' && 'cards' in decision) {
        cardsPlayed = decision.cards.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`);

        // Flag analysis
        const playedRanks = decision.cards.map(c => rv(c.rank));
        const maxPlayedRank = Math.max(...playedRanks);
        const isBomb = classifyBomb(decision.cards) !== null;

        // Flag: bomb used on non-bomb play when NO threat
        if (isBomb && round.lastPlay && round.lastPlay.format !== 'bomb' && opponentMinHand > 3) {
          flags.push('BOMB_ON_NON_BOMB');
        }

        // Flag: high card (A=11, 2=12) used to beat low card (<8) when NO threat
        if (maxPlayedRank >= 11 && context.lastPlayRank !== null && context.lastPlayRank < 8 && opponentMinHand > 3) {
          flags.push('HIGH_CARD_WASTED');
        }

        // Flag: played over teammate when teams are known
        if (context.lastPlayerTeam === player.team && context.lastPlayerTeam !== null
            && context.lastPlayerTeam !== 'unknown' && player.hand.length > 2) {
          flags.push('PLAYED_OVER_TEAMMATE');
        }

        // Flag: used bomb when opponent has many cards (truly no threat)
        if (isBomb && opponentMinHand >= 5 && player.hand.length >= 5) {
          flags.push('BOMB_WASTED_NO_THREAT');
        }

        // Flag: played 2 (highest single) when hand is large and no threat
        if (decision.cards.length === 1 && decision.cards[0].rank === '2' && player.hand.length >= 6 && opponentMinHand > 3) {
          flags.push('PLAYED_2_WITH_BIG_HAND');
        }

        const result = engine.playCards(currentId, decision.cards);
        if (!result.success) {
          engine.pass(currentId);
          continue;
        }
      } else if (decision.action === 'pass') {
        // Flag: passed when opponent is close to going out
        if (opponentMinHand <= 2 && round.lastPlay) {
          const lastPlayerHand = context.lastPlayerId
            ? st.players.find(p => p.id === context.lastPlayerId)?.handSize ?? 99
            : 99;
          if (lastPlayerHand <= 3 && context.lastPlayerTeam !== player.team) {
            // Get all possible beating plays
            let bp = findBeatingPlays(player.hand, round.lastPlay, false);

            // During cha-go waiting_go, the game only allows a single of the exact
            // trigger rank. findBeatingPlays doesn't know about this constraint, so
            // it may return higher pairs/singles that aren't legally playable.
            // Filter them out so we only flag REAL strategy bugs.
            const chaGoPhase = round.chaGoState?.phase ?? null;
            const triggerRank = round.chaGoState?.triggerRank ?? null;
            if (chaGoPhase === 'waiting_go' && triggerRank) {
              bp = bp.filter(play =>
                play.length === 1 && play[0].rank === triggerRank,
              );
            }

            if (bp.length > 0) {
              // Bot HAS valid plays but chose to pass — strategy bug
              flags.push('PASSED_LETTING_OPPONENT_OUT');
              // Record what plays were available
              for (const play of bp.slice(0, 5)) {
                alternatives.push(play);
              }
            } else {
              // Bot genuinely has no legal play — unavoidable
              flags.push('NO_PLAY_OPPONENT_OUT');
            }
          }
        }

        engine.pass(currentId);
      } else if (decision.action === 'cha' && 'cards' in decision) {
        cardsPlayed = decision.cards.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`);
        const result = engine.cha(currentId, decision.cards);
        if (!result.success) { engine.pass(currentId); continue; }
      } else if (decision.action === 'go_cha' && 'cards' in decision) {
        cardsPlayed = decision.cards.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`);
        const result = engine.goCha(currentId, decision.cards);
        if (!result.success) { engine.pass(currentId); continue; }
      } else if (decision.action === 'decline_cha') {
        engine.declineCha(currentId);
      } else if (decision.action === 'defuse' && 'cards' in decision) {
        cardsPlayed = decision.cards.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`);
        const result = engine.defuse(currentId, decision.cards);
        if (!result.success) { engine.pass(currentId); continue; }
      } else {
        engine.pass(currentId);
      }

      if (flags.length > 0) {
        decisions.push({
          gameIndex,
          roundNumber,
          playerId: currentId,
          playerName: PLAYER_NAMES[strategyIdx],
          playerTeam: player.team ?? 'unknown',
          handSize: player.hand.length,
          hand: player.hand.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`),
          action: decision.action,
          cardsPlayed,
          context,
          alternatives: alternatives.map(a => a.map(c => `${c.rank}${c.isRed ? 'r' : 'b'}`).join(',')),
          flags,
        });
      }
    }

    const finalState = engine.getState();
    if (finalState.phase !== 'game_over') {
      if (gameIndex < 3) {
        const handSizes = finalState.players.map(p => `${p.name}:${p.handSize}`).join(' ');
        console.error(`Game ${gameIndex} stuck after ${iterations} iterations, phase=${finalState.phase}, round=${roundNumber}, hands=[${handSizes}]`);
        if (finalState.round) {
          console.error(`  currentPlayer=${finalState.round.currentPlayerId}, leader=${finalState.round.leaderId}, format=${finalState.round.currentFormat}, chaGo=${finalState.round.chaGoState?.phase ?? 'none'}`);
        }
      }
      return null;
    }

    const result = engine.getGameResult();
    if (!result) return null;

    const endHandSizes: Record<string, number> = {};
    for (const p of finalState.players) {
      endHandSizes[p.name] = p.handSize;
    }

    return {
      gameIndex,
      winner: result.scoringTeam,
      scoringTeam: result.scoringTeam,
      scoringTeamWon: result.scoringTeamWon,
      trapped: result.trapped,
      finishOrder: finalState.finishOrder,
      decisions,
      endHandSizes,
      totalRounds: roundNumber,
    };
  }

  private findAlternatives(hand: Card[], round: RoundInfo): Card[][] {
    if (!round.lastPlay) return [];
    const results: Card[][] = [];

    // Find all possible beating plays
    const format = round.lastPlay.format;
    if (format === 'single') {
      for (const c of hand) {
        if (canBeat([c], round.lastPlay)) results.push([c]);
      }
    } else if (format === 'pair') {
      const groups = new Map<string, Card[]>();
      for (const c of hand) {
        const arr = groups.get(c.rank) ?? [];
        arr.push(c);
        groups.set(c.rank, arr);
      }
      for (const [, cards] of groups) {
        if (cards.length >= 2) {
          const pair = [cards[0], cards[1]];
          if (canBeat(pair, round.lastPlay)) results.push(pair);
        }
      }
    }

    return results;
  }

  private summarize(analyses: GameAnalysis[]): EvolutionReport {
    const antiPatternCounts: Record<string, number> = {};
    const allDecisions: DecisionRecord[] = [];
    let totalTrapped = 0;
    let totalRounds = 0;
    let scoringWins = 0;
    let trappedHandSizes = 0;
    let trappedCount = 0;
    let bombsHeldAtEnd = 0;

    for (const a of analyses) {
      totalTrapped += a.trapped.length;
      totalRounds += a.totalRounds;
      if (a.scoringTeamWon) scoringWins++;

      for (const d of a.decisions) {
        allDecisions.push(d);
        for (const flag of d.flags) {
          antiPatternCounts[flag] = (antiPatternCounts[flag] ?? 0) + 1;
        }
      }

      // Check for bombs held at end by trapped players
      for (const trappedId of a.trapped) {
        const p = PLAYER_IDS.indexOf(trappedId);
        if (p !== -1) {
          trappedHandSizes += a.endHandSizes[PLAYER_NAMES[p]] ?? 0;
          trappedCount++;
        }
      }
    }

    const n = analyses.length || 1;

    // Sort worst decisions by severity. HIGH_CARD_WASTED is a warning signal,
    // not an error — it has correct tactical uses (blocking low-hand opponents).
    // Only surface it in worst decisions if combined with other flags.
    const worstDecisions = allDecisions
      .sort((a, b) => {
        const priority = (d: DecisionRecord) => {
          let score = 0;
          if (d.flags.includes('PASSED_LETTING_OPPONENT_OUT')) score += 10;
          if (d.flags.includes('BOMB_WASTED_NO_THREAT')) score += 8;
          if (d.flags.includes('BOMB_ON_NON_BOMB')) score += 6;
          if (d.flags.includes('PLAYED_OVER_TEAMMATE')) score += 5;
          if (d.flags.includes('PLAYED_2_WITH_BIG_HAND')) score += 3;
          // HIGH_CARD_WASTED only counts when combined with another flag
          if (d.flags.includes('HIGH_CARD_WASTED') && d.flags.length > 1) score += 2;
          return score;
        };
        return priority(b) - priority(a);
      })
      .slice(0, 20);

    return {
      gamesAnalyzed: analyses.length,
      metrics: {
        avgTrapped: totalTrapped / n,
        avgRounds: totalRounds / n,
        scoringTeamWinRate: scoringWins / n,
        avgEndHandSizeTrapped: trappedCount > 0 ? trappedHandSizes / trappedCount : 0,
        bombsUsedOnNonBombs: antiPatternCounts['BOMB_ON_NON_BOMB'] ?? 0,
        highCardsWasted: antiPatternCounts['HIGH_CARD_WASTED'] ?? 0,
        bombsHeldAtEnd,
        passedWhenCouldBlock: antiPatternCounts['PASSED_LETTING_OPPONENT_OUT'] ?? 0,
        playedOverTeammate: antiPatternCounts['PLAYED_OVER_TEAMMATE'] ?? 0,
        failedToBlockLowHandOpponent: antiPatternCounts['PASSED_LETTING_OPPONENT_OUT'] ?? 0,
      },
      worstDecisions,
      antiPatternCounts,
    };
  }
}

/**
 * Format a report for human/AI review.
 */
export function formatReport(report: EvolutionReport): string {
  const lines: string[] = [];
  lines.push(`\n=== STRATEGY EVOLUTION REPORT (${report.gamesAnalyzed} games completed, ${(report as any).completionRate ?? 'N/A'}) ===\n`);

  lines.push('--- METRICS ---');
  lines.push(`Avg trapped players/game: ${report.metrics.avgTrapped.toFixed(2)}`);
  lines.push(`Avg rounds/game: ${report.metrics.avgRounds.toFixed(1)}`);
  lines.push(`Scoring team win rate: ${(report.metrics.scoringTeamWinRate * 100).toFixed(1)}%`);
  lines.push(`Avg hand size of trapped players: ${report.metrics.avgEndHandSizeTrapped.toFixed(1)}`);
  lines.push('');

  lines.push('--- ANTI-PATTERN COUNTS ---');
  const WARNING_FLAGS = new Set(['HIGH_CARD_WASTED', 'PLAYED_OVER_TEAMMATE', 'NO_PLAY_OPPONENT_OUT']);
  const sorted = Object.entries(report.antiPatternCounts).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sorted) {
    const label = WARNING_FLAGS.has(pattern) ? '(warning)' : '(error)';
    lines.push(`  ${pattern}: ${count} ${label}`);
  }
  lines.push('');

  lines.push('--- TOP 10 WORST DECISIONS ---');
  for (const d of report.worstDecisions.slice(0, 10)) {
    lines.push(`  Game ${d.gameIndex}, Round ${d.roundNumber}: ${d.playerName} (${d.playerTeam}, ${d.handSize} cards)`);
    lines.push(`    Action: ${d.action}${d.cardsPlayed ? ' → ' + d.cardsPlayed.join(' ') : ''}`);
    lines.push(`    Context: format=${d.context.currentFormat}, lastPlayRank=${d.context.lastPlayRank}, oppMinHand=${d.context.opponentMinHand}`);
    lines.push(`    Flags: ${d.flags.join(', ')}`);
    if (d.alternatives.length > 0) {
      lines.push(`    Alternatives: ${d.alternatives.slice(0, 5).join(' | ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
