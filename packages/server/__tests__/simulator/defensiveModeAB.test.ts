import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import type { PlayerStrategy } from './strategies.js';
import {
  SmartRacerStrategy,
  PreFixDStrategy,
} from '../../src/bot/BotManager.js';

const post: PlayerStrategy = SmartRacerStrategy as unknown as PlayerStrategy;
const pre: PlayerStrategy = PreFixDStrategy as unknown as PlayerStrategy;

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
  // Game shape
  bombsPlayed: number;
  doublesOccurred: number;
  scoringTeamFailures: number;
  avgRoundsPerGame: number;
  // Payout-magnitude metrics (the user's "more ties" hypothesis)
  zeroPayoutGames: number;
  totalPayoutMagnitude: number; // sum of sum(|payout_i|) per game
}

function runHeadToHead(
  label: string,
  numGamesPerOrientation: number,
): MatchupResult {
  const seatTotalA = [0, 0, 0, 0, 0, 0];
  const seatTotalB = [0, 0, 0, 0, 0, 0];
  const gameDeltas: number[] = [];
  let zeroPayoutGames = 0;
  let totalPayoutMagnitude = 0;

  // Orientation A: post on even seats, pre on odd.
  const lineupA: PlayerStrategy[] = [post, pre, post, pre, post, pre];
  const simA = new GameSimulator({
    numGames: numGamesPerOrientation,
    strategies: lineupA,
    onGameComplete: (_idx, gr) => {
      if (!gr) return;
      let postG = 0, preG = 0;
      let gameMagnitude = 0;
      for (let i = 0; i < 6; i++) {
        const p = gr.payouts[PLAYER_IDS[i]] ?? 0;
        seatTotalA[i] += p;
        gameMagnitude += Math.abs(p);
        if (i % 2 === 0) postG += p; else preG += p;
      }
      gameDeltas.push(postG - preG);
      totalPayoutMagnitude += gameMagnitude;
      if (gameMagnitude === 0) zeroPayoutGames++;
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
      let gameMagnitude = 0;
      for (let i = 0; i < 6; i++) {
        const p = gr.payouts[PLAYER_IDS[i]] ?? 0;
        seatTotalB[i] += p;
        gameMagnitude += Math.abs(p);
        if (i % 2 === 1) postG += p; else preG += p;
      }
      gameDeltas.push(postG - preG);
      totalPayoutMagnitude += gameMagnitude;
      if (gameMagnitude === 0) zeroPayoutGames++;
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
    zeroPayoutGames,
    totalPayoutMagnitude,
  };
}

function runAllVariant(
  label: string,
  strategy: PlayerStrategy,
  numGames: number,
): { games: number; zeroPayoutGames: number; totalMagnitude: number; scoringFailures: number; avgRounds: number } {
  let zeroPayoutGames = 0;
  let totalMagnitude = 0;
  const sim = new GameSimulator({
    numGames,
    strategies: [strategy, strategy, strategy, strategy, strategy, strategy],
    onGameComplete: (_idx, gr) => {
      if (!gr) return;
      let mag = 0;
      for (let i = 0; i < 6; i++) {
        mag += Math.abs(gr.payouts[PLAYER_IDS[i]] ?? 0);
      }
      totalMagnitude += mag;
      if (mag === 0) zeroPayoutGames++;
    },
  });
  const result = sim.run();
  return {
    games: result.gamesCompleted,
    zeroPayoutGames,
    totalMagnitude,
    scoringFailures: result.stats.scoringTeamFailures,
    avgRounds: result.stats.avgRoundsPerGame,
  };
}

function verdict(z: number): string {
  if (z > 2) return 'SIG WIN';
  if (z > 1.5) return 'marginal+';
  if (z > -1.5) return 'noise';
  if (z > -2) return 'marginal-';
  return 'SIG LOSS';
}

describe('Fix D — defensive mode A/B', () => {
  // 15K H2H games (7500 per orientation × 2). At per-game stdev ~8, SE ~1000.
  // Need |net| > ~2000 (Δ/game > 0.13) to detect at z>2.
  const NUM_GAMES_PER_ORIENTATION = 7500;
  const TIMEOUT_MS = 1_800_000;

  it('SmartRacer (with defensive) vs PreFixD (without) head-to-head', () => {
    const r = runHeadToHead('Defensive vs no-defensive', NUM_GAMES_PER_ORIENTATION);

    console.log('\n=========== DEFENSIVE MODE A/B (Fix D isolated) ===========');
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
    console.log('');
    console.log('Payout-magnitude (the "more ties" hypothesis):');
    console.log(`  Zero-payout games:  ${r.zeroPayoutGames} (${(r.zeroPayoutGames / r.numGames * 100).toFixed(1)}%)`);
    console.log(`  Total |payout|:     ${r.totalPayoutMagnitude}`);
    console.log(`  Avg |payout|/game:  ${(r.totalPayoutMagnitude / r.numGames).toFixed(2)}`);

    expect(r.numGames).toBe(NUM_GAMES_PER_ORIENTATION * 2);
  }, TIMEOUT_MS);

  it('homogeneous lineups: all-defensive vs all-no-defensive (cleaner signal)', () => {
    const N = 5000;

    const allPost = runAllVariant('all-SmartRacer', post, N);
    const allPre = runAllVariant('all-PreFixD', pre, N);

    const postZeroRate = allPost.zeroPayoutGames / allPost.games;
    const preZeroRate = allPre.zeroPayoutGames / allPre.games;
    const postFailRate = allPost.scoringFailures / allPost.games;
    const preFailRate = allPre.scoringFailures / allPre.games;
    const postAvgMag = allPost.totalMagnitude / allPost.games;
    const preAvgMag = allPre.totalMagnitude / allPre.games;

    console.log('\n=========== HOMOGENEOUS LINEUPS (Fix D effect on game shape) ===========');
    console.log('Metric                  All-SmartRacer    All-PreFixD       Δ');
    console.log(`Games completed:        ${allPost.games.toString().padEnd(18)}${allPre.games.toString().padEnd(18)}`);
    console.log(`Zero-payout games:      ${allPost.zeroPayoutGames.toString().padEnd(18)}${allPre.zeroPayoutGames.toString().padEnd(18)}${(allPost.zeroPayoutGames - allPre.zeroPayoutGames)}`);
    console.log(`Zero-payout rate:       ${(postZeroRate * 100).toFixed(2).padEnd(8)}%         ${(preZeroRate * 100).toFixed(2).padEnd(8)}%         ${((postZeroRate - preZeroRate) * 100).toFixed(2)}%`);
    console.log(`Scoring failures:       ${allPost.scoringFailures.toString().padEnd(18)}${allPre.scoringFailures.toString().padEnd(18)}${(allPost.scoringFailures - allPre.scoringFailures)}`);
    console.log(`Scoring failure rate:   ${(postFailRate * 100).toFixed(2).padEnd(8)}%         ${(preFailRate * 100).toFixed(2).padEnd(8)}%         ${((postFailRate - preFailRate) * 100).toFixed(2)}%`);
    console.log(`Avg |payout|/game:      ${postAvgMag.toFixed(2).padEnd(18)}${preAvgMag.toFixed(2).padEnd(18)}${(postAvgMag - preAvgMag).toFixed(2)}`);
    console.log(`Avg rounds/game:        ${allPost.avgRounds.toFixed(2).padEnd(18)}${allPre.avgRounds.toFixed(2).padEnd(18)}${(allPost.avgRounds - allPre.avgRounds).toFixed(2)}`);

    expect(allPost.games).toBe(N);
    expect(allPre.games).toBe(N);
  }, TIMEOUT_MS);
});
