import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import type { PlayerStrategy } from './strategies.js';
import {
  SmartRacerStrategy,
  SmartRacerNoOrphanPriorityStrategy,
} from '../../src/bot/BotManager.js';

const post: PlayerStrategy = SmartRacerStrategy as unknown as PlayerStrategy;
const pre: PlayerStrategy = SmartRacerNoOrphanPriorityStrategy as unknown as PlayerStrategy;

const PLAYER_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] as const;

interface HandSizeHistogram {
  byHandSize: Map<number, number>;
  total: number;
}

function emptyHist(): HandSizeHistogram {
  return { byHandSize: new Map(), total: 0 };
}

function record(hist: HandSizeHistogram, sz: number): void {
  hist.byHandSize.set(sz, (hist.byHandSize.get(sz) ?? 0) + 1);
  hist.total++;
}

function pct(hist: HandSizeHistogram, sz: number): string {
  const n = hist.byHandSize.get(sz) ?? 0;
  return hist.total ? `${((100 * n) / hist.total).toFixed(2)}%` : 'n/a';
}

function pctRange(hist: HandSizeHistogram, lo: number, hi: number): string {
  let n = 0;
  for (let s = lo; s <= hi; s++) n += hist.byHandSize.get(s) ?? 0;
  return hist.total ? `${((100 * n) / hist.total).toFixed(2)}%` : 'n/a';
}

function runHeadToHead(label: string, numGamesPerOrientation: number) {
  const gameDeltas: number[] = [];
  const postHandSizes = emptyHist();
  const preHandSizes = emptyHist();
  let postTotal = 0;
  let preTotal = 0;
  let bombsPlayed = 0;
  let scoringTeamFailures = 0;
  let avgRoundsAcc = 0;
  let totalGames = 0;

  for (const orient of [0, 1] as const) {
    const lineup: PlayerStrategy[] =
      orient === 0
        ? [post, pre, post, pre, post, pre]
        : [pre, post, pre, post, pre, post];

    const sim = new GameSimulator({
      numGames: numGamesPerOrientation,
      strategies: lineup,
      onGameComplete: (_idx, gr, engine) => {
        if (!gr) return;
        let postG = 0, preG = 0;
        const state = engine.getState();
        for (let i = 0; i < 6; i++) {
          const p = gr.payouts[PLAYER_IDS[i]] ?? 0;
          const isPost = orient === 0 ? i % 2 === 0 : i % 2 === 1;
          if (isPost) { postTotal += p; postG += p; }
          else        { preTotal  += p; preG  += p; }
          const sz = state.players[i].handSize;
          record(isPost ? postHandSizes : preHandSizes, sz);
        }
        gameDeltas.push(postG - preG);
      },
    });
    const r = sim.run();
    bombsPlayed += r.stats.bombsPlayed;
    scoringTeamFailures += r.stats.scoringTeamFailures;
    avgRoundsAcc += r.stats.avgRoundsPerGame * r.gamesCompleted;
    totalGames += r.gamesCompleted;
  }

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
    scoringTeamFailures,
    avgRoundsPerGame: avgRoundsAcc / totalGames,
    postHandSizes,
    preHandSizes,
  };
}

function verdict(z: number): string {
  if (z >= 2) return 'SIG WIN';
  if (z <= -2) return 'SIG LOSS';
  return 'no signal (|z|<2)';
}

describe('Orphan-priority fix A/B (isolated)', () => {
  // 15K games. Per-game σ for similar-strategy matchups is ~8, so SE ~1000.
  // The orphan-priority fix only fires when a specific structural condition
  // holds (mid-rank singleton + rank publicly exhausted at lead time), so the
  // signal is small per game — need enough games to detect it.
  const NUM_GAMES_PER_ORIENTATION = 7500;
  const TIMEOUT_MS = 1_800_000;

  it('SmartRacer with orphan-priority vs without — head-to-head', () => {
    const r = runHeadToHead('Orphan-priority A/B', NUM_GAMES_PER_ORIENTATION);

    console.log('\n=========== ORPHAN-PRIORITY A/B ===========');
    console.log(`Games:              ${r.numGames}`);
    console.log(`With-fix total:     ${r.postTotal}`);
    console.log(`Without-fix total:  ${r.preTotal}`);
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
    console.log(`  Scoring failures:   ${r.scoringTeamFailures} (${(r.scoringTeamFailures / r.numGames * 100).toFixed(1)}%)`);
    console.log('');
    console.log('Hand-size-at-game-end distribution (per player-instance):');
    console.log(`                       with-fix       no-fix       Δ`);
    const dump = (label: string, postStr: string, preStr: string) => {
      const postN = Number.parseFloat(postStr);
      const preN = Number.parseFloat(preStr);
      const delta = Number.isFinite(postN - preN) ? (postN - preN).toFixed(2) : 'n/a';
      console.log(`  ${label.padEnd(20)} ${postStr.padStart(8)}      ${preStr.padStart(8)}      ${delta}`);
    };
    dump('hand=0 (out)',    pct(r.postHandSizes, 0), pct(r.preHandSizes, 0));
    dump('hand=1 (stuck)',  pct(r.postHandSizes, 1), pct(r.preHandSizes, 1));
    dump('hand=2',          pct(r.postHandSizes, 2), pct(r.preHandSizes, 2));
    dump('hand=3-5',        pctRange(r.postHandSizes, 3, 5), pctRange(r.preHandSizes, 3, 5));
    dump('hand=6+',         pctRange(r.postHandSizes, 6, 13), pctRange(r.preHandSizes, 6, 13));
    console.log(`  total instances:     ${r.postHandSizes.total.toString().padStart(7)}      ${r.preHandSizes.total.toString().padStart(7)}`);

    expect(r.numGames).toBe(NUM_GAMES_PER_ORIENTATION * 2);
  }, TIMEOUT_MS);
});
