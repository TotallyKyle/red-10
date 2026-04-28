import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import { DecisionRecorder } from './decisionRecorder.js';
import { RandomStrategy, AggressiveStrategy } from './strategies.js';
import type { PlayerStrategy } from './strategies.js';
import type { DecisionRecord } from './decisionRecorder.js';
import {
  bucketRecords,
  globalMeanPayout,
  rankByPayoutDeviation,
  formatReport,
  type BucketStats,
} from './analyzeDecisions.js';

function runWithRecorder(numGames: number, strategies: PlayerStrategy[]): DecisionRecorder {
  const recorder = new DecisionRecorder();
  const wrapped = strategies.map(s => recorder.wrap(s));
  new GameSimulator({
    numGames,
    strategies: wrapped,
    onGameComplete: (_idx, result, engine) => recorder.finalizeGame(engine, result),
  }).run();
  return recorder;
}

function makeRecord(overrides: {
  opponentMinHandSize?: number;
  handSize?: number;
  gamePayout?: number;
  ownDecisionsUntilOut?: number | null;
  wonRound?: boolean | null;
  action?: string;
  playedFormat?: string | null;
}): DecisionRecord {
  return {
    context: {
      gameIndex: 0,
      decisionIndex: 0,
      roundIndex: 0,
      playerId: 'p0',
      seatIndex: 0,
      myTeam: 'black10',
      teamsRevealed: false,
      handSize: overrides.handSize ?? 5,
      handRankCounts: new Array(13).fill(0),
      isLeading: false,
      currentFormat: null,
      lastPlayLength: 0,
      opponentMinHandSize: overrides.opponentMinHandSize ?? 5,
      activeOpponents: 3,
      teammateMinHandSize: 5,
      phase: 'playing',
      currentLeaderId: 'p1',
    },
    decision: {
      action: (overrides.action ?? 'play') as DecisionRecord['decision']['action'],
      cards: [],
      playedFormat: (overrides.playedFormat !== undefined ? overrides.playedFormat : 'single') as DecisionRecord['decision']['playedFormat'],
    },
    outcome: {
      finalPosition: 3,
      gamePayout: overrides.gamePayout ?? 0,
      ownDecisionsUntilOut: overrides.ownDecisionsUntilOut !== undefined ? overrides.ownDecisionsUntilOut : 5,
      wonRound: overrides.wonRound !== undefined ? overrides.wonRound : null,
    },
  };
}

describe('analyzeDecisions', () => {
  it('empty input: bucketRecords returns []', () => {
    expect(bucketRecords([], ['phase'])).toEqual([]);
  });

  it('empty input: globalMeanPayout returns 0', () => {
    expect(globalMeanPayout([])).toBe(0);
  });

  it('empty input: rankByPayoutDeviation returns []', () => {
    expect(rankByPayoutDeviation([], 0)).toEqual([]);
  });

  it('empty input: formatReport returns non-empty string', () => {
    const report = formatReport([], 0);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(0);
  });

  it('single feature bucketing by phase: counts sum to recorder.size()', () => {
    const recorder = runWithRecorder(5, Array(6).fill(RandomStrategy));
    const records = recorder.getRecords();
    const buckets = bucketRecords(records, ['phase']);
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    expect(buckets.length).toBeLessThanOrEqual(2);
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(recorder.size());
    for (const b of buckets) {
      expect(b.count).toBeGreaterThan(0);
    }
  });

  it('single feature bucketing by handSizeBucket: buckets present, counts sum to total', () => {
    const recorder = runWithRecorder(5, Array(6).fill(AggressiveStrategy));
    const records = recorder.getRecords();
    const buckets = bucketRecords(records, ['handSizeBucket']);
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(records.length);

    const tinyRec = makeRecord({ handSize: 2 });
    const largeRec = makeRecord({ handSize: 11 });
    const tinyBuckets = bucketRecords([tinyRec], ['handSizeBucket']);
    const largeBuckets = bucketRecords([largeRec], ['handSizeBucket']);
    expect(tinyBuckets[0].key.handSizeBucket).toBe('tiny');
    expect(largeBuckets[0].key.handSizeBucket).toBe('large');
  });

  it('multi-feature bucketing: each bucket key has all requested features', () => {
    const recorder = runWithRecorder(5, Array(6).fill(AggressiveStrategy));
    const records = recorder.getRecords();
    const features = ['phase', 'action', 'handSizeBucket'] as const;
    const buckets = bucketRecords(records, [...features]);

    const seen = new Set<string>();
    for (const b of buckets) {
      expect(b.key.phase).toBeDefined();
      expect(b.key.action).toBeDefined();
      expect(b.key.handSizeBucket).toBeDefined();
      const ks = JSON.stringify(b.key, Object.keys(b.key).sort());
      expect(seen.has(ks)).toBe(false);
      seen.add(ks);
    }

    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(records.length);
  });

  it('threat bucket boundaries: opponentMinHandSize maps correctly', () => {
    const cases: [number, string][] = [
      [1, 'high'],
      [2, 'high'],
      [3, 'medium'],
      [4, 'medium'],
      [5, 'low'],
      [50, 'low'],
      [99, 'none'],
    ];
    for (const [handSize, expected] of cases) {
      const record = makeRecord({ opponentMinHandSize: handSize });
      const [bucket] = bucketRecords([record], ['threatBucket']);
      expect(bucket.key.threatBucket).toBe(expected);
    }
  });

  it('globalMeanPayout: returns correct arithmetic mean', () => {
    const payouts = [10, -5, 3, 0, 2];
    const expected = (10 + -5 + 3 + 0 + 2) / 5;
    const records = payouts.map(p => makeRecord({ gamePayout: p }));
    expect(globalMeanPayout(records)).toBeCloseTo(expected);
  });

  it('payoutStdev and payoutSE: population formula, correct values', () => {
    const records = [0, 0, 6, 6].map(p => makeRecord({ gamePayout: p }));
    const [bucket] = bucketRecords(records, []);
    expect(bucket.meanPayout).toBeCloseTo(3);
    expect(bucket.payoutStdev).toBeCloseTo(3);
    expect(bucket.payoutSE).toBeCloseTo(1.5);
  });

  it('rankByPayoutDeviation: orders by |deviation| * sqrt(count) descending', () => {
    const makeBucket = (meanPayout: number, count: number): BucketStats => ({
      key: {},
      count,
      meanPayout,
      payoutStdev: 0,
      payoutSE: 0,
      meanTurnsUntilOut: NaN,
      wonRoundRate: null,
    });

    const buckets: BucketStats[] = [
      makeBucket(5, 100),
      makeBucket(-10, 100),
      makeBucket(1, 100),
      makeBucket(0, 100),
    ];

    const ranked = rankByPayoutDeviation(buckets, 0, 1);
    expect(ranked[0].meanPayout).toBe(-10);
    expect(ranked[1].meanPayout).toBe(5);
    expect(ranked[2].meanPayout).toBe(1);
    expect(ranked[3].meanPayout).toBe(0);
  });

  it('rankByPayoutDeviation: filters out buckets below minCount', () => {
    const makeBucket = (meanPayout: number, count: number): BucketStats => ({
      key: {},
      count,
      meanPayout,
      payoutStdev: 0,
      payoutSE: 0,
      meanTurnsUntilOut: NaN,
      wonRoundRate: null,
    });

    const buckets: BucketStats[] = [
      makeBucket(1000, 5),
      makeBucket(2, 100),
    ];

    const ranked = rankByPayoutDeviation(buckets, 0, 30);
    expect(ranked.length).toBe(1);
    expect(ranked[0].meanPayout).toBe(2);
  });

  it('wonRoundRate: computes correctly for play actions; null for pass-only', () => {
    const playRecords = [
      makeRecord({ action: 'play', wonRound: true }),
      makeRecord({ action: 'play', wonRound: false }),
      makeRecord({ action: 'play', wonRound: true }),
    ];
    const [bucket] = bucketRecords(playRecords, []);
    expect(bucket.wonRoundRate).toBeCloseTo(2 / 3);

    const passRecords = [
      makeRecord({ action: 'pass', wonRound: null }),
      makeRecord({ action: 'pass', wonRound: null }),
    ];
    const [passBucket] = bucketRecords(passRecords, []);
    expect(passBucket.wonRoundRate).toBeNull();
  });

  it('meanTurnsUntilOut: skips null values in average', () => {
    const records = [1, 2, null, 3].map(v =>
      makeRecord({ ownDecisionsUntilOut: v }),
    );
    const [bucket] = bucketRecords(records, []);
    expect(bucket.meanTurnsUntilOut).toBeCloseTo(2);
  });

  it('end-to-end smoke test: runs sim, buckets, ranks, formats without throwing', () => {
    const recorder = runWithRecorder(10, Array(6).fill(AggressiveStrategy));
    const records = recorder.getRecords();
    const buckets = bucketRecords(records, ['phase', 'handSizeBucket']);
    const globalMean = globalMeanPayout(records);
    const ranked = rankByPayoutDeviation(buckets, globalMean);
    const report = formatReport(ranked, globalMean);
    expect(report).toMatch(/bucket/i);
  });

  it('deterministic ordering: same records produce identical bucket arrays', () => {
    const recorder = runWithRecorder(5, Array(6).fill(RandomStrategy));
    const records = recorder.getRecords();
    const a = bucketRecords(records, ['phase', 'action']);
    const b = bucketRecords(records, ['phase', 'action']);
    expect(a).toEqual(b);
  });
});
