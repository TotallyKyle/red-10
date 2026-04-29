import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import type { PlayerStrategy } from './strategies.js';
import {
  SmartRacerStrategy,
  LegacyPreFixesStrategy,
} from '../../src/bot/BotManager.js';

const post: PlayerStrategy = SmartRacerStrategy as unknown as PlayerStrategy;
const pre: PlayerStrategy = LegacyPreFixesStrategy as unknown as PlayerStrategy;

const PLAYER_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] as const;

interface MatchupResult {
  label: string;
  postTotal: number;
  preTotal: number;
  numGames: number;
  netDelta: number;
  perGameDelta: number;
  perGameStdev: number;
  seTotal: number;
  zScore: number;
  bombsPlayed: number;
  doublesOccurred: number;
  scoringTeamFailures: number;
  avgRoundsPerGame: number;
}

function runHeadToHead(
  label: string,
  numGamesPerOrientation: number,
): MatchupResult {
  const seatTotalA = [0, 0, 0, 0, 0, 0];
  const seatTotalB = [0, 0, 0, 0, 0, 0];
  const gameDeltas: number[] = [];

  // Orientation A: post (with fixes) on even seats, pre (legacy) on odd.
  const lineupA: PlayerStrategy[] = [post, pre, post, pre, post, pre];
  const simA = new GameSimulator({
    numGames: numGamesPerOrientation,
    strategies: lineupA,
    onGameComplete: (_idx, gr) => {
      if (!gr) return;
      let postG = 0, preG = 0;
      for (let i = 0; i < 6; i++) {
        const p = gr.payouts[PLAYER_IDS[i]] ?? 0;
        seatTotalA[i] += p;
        if (i % 2 === 0) postG += p; else preG += p;
      }
      gameDeltas.push(postG - preG);
    },
  });
  const resultA = simA.run();

  // Orientation B: post on odd seats, pre on even.
  const lineupB: PlayerStrategy[] = [pre, post, pre, post, pre, post];
  const simB = new GameSimulator({
    numGames: numGamesPerOrientation,
    strategies: lineupB,
    onGameComplete: (_idx, gr) => {
      if (!gr) return;
      let postG = 0, preG = 0;
      for (let i = 0; i < 6; i++) {
        const p = gr.payouts[PLAYER_IDS[i]] ?? 0;
        seatTotalB[i] += p;
        if (i % 2 === 1) postG += p; else preG += p;
      }
      gameDeltas.push(postG - preG);
    },
  });
  const resultB = simB.run();

  const postTotal =
    seatTotalA[0] + seatTotalA[2] + seatTotalA[4] +
    seatTotalB[1] + seatTotalB[3] + seatTotalB[5];
  const preTotal =
    seatTotalA[1] + seatTotalA[3] + seatTotalA[5] +
    seatTotalB[0] + seatTotalB[2] + seatTotalB[4];

  const totalGames = resultA.gamesCompleted + resultB.gamesCompleted;
  const bombsPlayed = resultA.stats.bombsPlayed + resultB.stats.bombsPlayed;
  const doublesOccurred = resultA.stats.doublesOccurred + resultB.stats.doublesOccurred;
  const scoringTeamFailures = resultA.stats.scoringTeamFailures + resultB.stats.scoringTeamFailures;
  const avgRoundsPerGame =
    (resultA.stats.avgRoundsPerGame * resultA.gamesCompleted +
      resultB.stats.avgRoundsPerGame * resultB.gamesCompleted) / totalGames;

  const meanDelta = gameDeltas.reduce((a, b) => a + b, 0) / gameDeltas.length;
  const variance = gameDeltas.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / (gameDeltas.length - 1);
  const perGameStdev = Math.sqrt(variance);

  const netDelta = postTotal - preTotal;
  const seTotal = perGameStdev * Math.sqrt(totalGames);
  const zScore = netDelta / seTotal;

  return {
    label,
    postTotal,
    preTotal,
    numGames: totalGames,
    netDelta,
    perGameDelta: netDelta / totalGames,
    perGameStdev,
    seTotal,
    zScore,
    bombsPlayed,
    doublesOccurred,
    scoringTeamFailures,
    avgRoundsPerGame,
  };
}

function verdict(z: number): string {
  if (z > 2) return 'SIG WIN';
  if (z > 1.5) return 'marginal+';
  if (z > -1.5) return 'noise';
  if (z > -2) return 'marginal-';
  return 'SIG LOSS';
}

describe('Strategy fixes (Apr 29) A/B vs pre-fix legacy', () => {
  // 15K H2H games (7500 per orientation × 2). At per-game stdev ~8, SE ~1000.
  // Need |net| > ~2000 (Δ/game > 0.13) to detect at z>2.
  const NUM_GAMES_PER_ORIENTATION = 7500;
  const TIMEOUT_MS = 1_800_000;

  it('post-fixes (current SmartRacer) vs pre-fixes (legacy) head-to-head', () => {
    const r = runHeadToHead('All 3 fixes vs legacy', NUM_GAMES_PER_ORIENTATION);

    console.log('\n=========== STRATEGY FIXES A/B ===========');
    console.log(`Games:              ${r.numGames}`);
    console.log(`Post-fix total:     ${r.postTotal}`);
    console.log(`Pre-fix total:      ${r.preTotal}`);
    console.log(`Net delta:          ${r.netDelta}`);
    console.log(`Δ/game:             ${r.perGameDelta.toFixed(3)}`);
    console.log(`Per-game σ:         ${r.perGameStdev.toFixed(2)}`);
    console.log(`SE (total):         ${r.seTotal.toFixed(0)}`);
    console.log(`z-score:            ${r.zScore.toFixed(2)}`);
    console.log(`Verdict:            ${verdict(r.zScore)}`);
    console.log('');
    console.log('Game-shape diagnostics:');
    console.log(`  Avg rounds/game:    ${r.avgRoundsPerGame.toFixed(2)}`);
    console.log(`  Bombs played:       ${r.bombsPlayed} (${(r.bombsPlayed / r.numGames).toFixed(2)}/game)`);
    console.log(`  Doubles occurred:   ${r.doublesOccurred} (${(r.doublesOccurred / r.numGames * 100).toFixed(1)}%)`);
    console.log(`  Scoring failures:   ${r.scoringTeamFailures} (${(r.scoringTeamFailures / r.numGames * 100).toFixed(1)}%)`);

    expect(r.numGames).toBe(NUM_GAMES_PER_ORIENTATION * 2);
  }, TIMEOUT_MS);
});
