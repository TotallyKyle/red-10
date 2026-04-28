import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import { DecisionRecorder } from './decisionRecorder.js';
import type { PlayerStrategy } from './strategies.js';
import { SmartRacerStrategy } from '../../src/bot/BotManager.js';
import {
  bucketRecords,
  globalMeanPayout,
  rankByPayoutDeviation,
  type BucketKey,
  type BucketStats,
} from './analyzeDecisions.js';

const baseline: PlayerStrategy = SmartRacerStrategy as unknown as PlayerStrategy;

function printRanking(label: string, buckets: BucketStats[], globalMean: number, topK = 8): void {
  console.log(`\n--- ${label} ---`);
  console.log(`(${buckets.length} buckets total, showing top ${Math.min(topK, buckets.length)})`);
  console.log(
    '  bucket'.padEnd(70) +
    'n'.padStart(7) +
    'payout'.padStart(10) +
    '±SE'.padStart(8) +
    'σ'.padStart(8) +
    'turns'.padStart(8) +
    'win%'.padStart(7),
  );
  console.log('  ' + '-'.repeat(106));
  for (const b of buckets.slice(0, topK)) {
    const keyStr = formatKey(b.key);
    const turnsStr = isNaN(b.meanTurnsUntilOut) ? 'N/A' : b.meanTurnsUntilOut.toFixed(2);
    const winStr = b.wonRoundRate === null ? 'N/A' : (b.wonRoundRate * 100).toFixed(1);
    const dev = b.meanPayout - globalMean;
    const devSign = dev > 0 ? '+' : '';
    console.log(
      '  ' + keyStr.padEnd(68) +
      b.count.toString().padStart(7) +
      `${devSign}${dev.toFixed(3)}`.padStart(10) +
      b.payoutSE.toFixed(2).padStart(8) +
      b.payoutStdev.toFixed(2).padStart(8) +
      turnsStr.padStart(8) +
      winStr.padStart(7),
    );
  }
}

function formatKey(key: BucketKey): string {
  const parts: string[] = [];
  for (const k of Object.keys(key).sort()) {
    const v = key[k as keyof BucketKey];
    parts.push(`${k}=${v}`);
  }
  return parts.join(', ') || '(all)';
}

describe('Sample decision analysis on production bot', () => {
  it('analyzes 1000 games of all-SmartRacer', () => {
    const NUM_GAMES = 1000;

    const recorder = new DecisionRecorder();
    const wrapped = Array(6).fill(0).map(() => recorder.wrap(baseline));

    const t0 = Date.now();
    new GameSimulator({
      numGames: NUM_GAMES,
      strategies: wrapped,
      onGameComplete: (_idx, result, engine) => recorder.finalizeGame(engine, result),
    }).run();
    const tElapsed = Date.now() - t0;

    const records = recorder.getRecords();
    const globalMean = globalMeanPayout(records);

    console.log(`\n=========== DECISION ANALYSIS REPORT ===========`);
    console.log(`Games: ${NUM_GAMES}, decisions recorded: ${records.length}, runtime: ${tElapsed}ms`);
    console.log(`Global mean payout: ${globalMean.toFixed(4)} (≈ 0 expected — zero-sum game)`);

    // Summary counts
    const playingRecords = records.filter(r => r.context.phase === 'playing');
    const playRecords = records.filter(r => r.decision.action === 'play');
    console.log(`Doubling-phase decisions: ${records.length - playingRecords.length}`);
    console.log(`Playing-phase decisions: ${playingRecords.length}`);
    console.log(`  of which 'play' action: ${playRecords.length} (${(playRecords.length / playingRecords.length * 100).toFixed(1)}%)`);

    // Analysis 1: action type
    {
      const buckets = bucketRecords(records, ['action']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('1. By action type', ranked, globalMean);
    }

    // Analysis 2: format played
    {
      const buckets = bucketRecords(records, ['playedFormat']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('2. By format played', ranked, globalMean);
    }

    // Analysis 3: hand size
    {
      const buckets = bucketRecords(records, ['handSizeBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('3. By hand size bucket', ranked, globalMean);
    }

    // Analysis 4: threat level
    {
      const buckets = bucketRecords(records, ['threatBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('4. By threat level', ranked, globalMean);
    }

    // Analysis 5: leading vs responding
    {
      const playing = records.filter(r => r.context.phase === 'playing');
      const buckets = bucketRecords(playing, ['isLeading']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('5. Leading vs responding (playing phase only)', ranked, globalMean);
    }

    // Analysis 6: action × hand size
    {
      const buckets = bucketRecords(records, ['action', 'handSizeBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('6. Action × hand size', ranked, globalMean);
    }

    // Analysis 7: action × threat
    {
      const buckets = bucketRecords(records, ['action', 'threatBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('7. Action × threat', ranked, globalMean);
    }

    // Analysis 8: format × threat (the meatiest combo)
    {
      const playing = records.filter(r => r.context.phase === 'playing');
      const buckets = bucketRecords(playing, ['playedFormat', 'threatBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 50);
      printRanking('8. Format × threat (playing phase)', ranked, globalMean);
    }

    // Analysis 9: format × hand size × threat (finest)
    {
      const playing = records.filter(r => r.context.phase === 'playing');
      const buckets = bucketRecords(playing, ['playedFormat', 'handSizeBucket', 'threatBucket']);
      const ranked = rankByPayoutDeviation(buckets, globalMean, 100);
      printRanking('9. Format × hand size × threat (playing phase, n≥100)', ranked, globalMean, 12);
    }

    expect(records.length).toBeGreaterThan(0);
  }, 600_000);
});
