import type { DecisionRecord } from './decisionRecorder.js';
import type { ActionType, PlayFormat } from '@red10/shared';

export type HandSizeBucket = 'tiny' | 'small' | 'medium' | 'large';
export type ThreatBucket = 'high' | 'medium' | 'low' | 'none';

export interface BucketKey {
  phase?: 'doubling' | 'playing';
  action?: ActionType;
  playedFormat?: PlayFormat | 'none';
  handSizeBucket?: HandSizeBucket;
  threatBucket?: ThreatBucket;
  isLeading?: boolean;
  activeOpponents?: number;
}

export interface BucketStats {
  key: BucketKey;
  count: number;
  meanPayout: number;
  payoutStdev: number;
  payoutSE: number;
  meanTurnsUntilOut: number;
  wonRoundRate: number | null;
}

function handSizeBucket(handSize: number): HandSizeBucket {
  if (handSize <= 2) return 'tiny';
  if (handSize <= 4) return 'small';
  if (handSize <= 7) return 'medium';
  return 'large';
}

function threatBucket(opponentMinHandSize: number): ThreatBucket {
  if (opponentMinHandSize <= 2) return 'high';
  if (opponentMinHandSize <= 4) return 'medium';
  if (opponentMinHandSize <= 98) return 'low';
  return 'none';
}

function extractFeature(record: DecisionRecord, feature: keyof BucketKey): BucketKey[keyof BucketKey] {
  const { context, decision } = record;
  switch (feature) {
    case 'phase':
      return context.phase;
    case 'action':
      return decision.action;
    case 'playedFormat':
      return decision.action === 'play' ? (decision.playedFormat ?? 'none') : 'none';
    case 'handSizeBucket':
      return handSizeBucket(context.handSize);
    case 'threatBucket':
      return threatBucket(context.opponentMinHandSize);
    case 'isLeading':
      return context.isLeading;
    case 'activeOpponents':
      return context.activeOpponents;
  }
}

function buildBucketKey(record: DecisionRecord, features: (keyof BucketKey)[]): BucketKey {
  const key: BucketKey = {};
  for (const f of features) {
    (key as Record<string, unknown>)[f] = extractFeature(record, f);
  }
  return key;
}

function keyString(key: BucketKey): string {
  return JSON.stringify(key, Object.keys(key).sort());
}

function computeStats(payouts: number[], turnsUntilOut: (number | null)[], wonRoundData: (boolean | null)[]): Pick<BucketStats, 'meanPayout' | 'payoutStdev' | 'payoutSE' | 'meanTurnsUntilOut' | 'wonRoundRate'> {
  const n = payouts.length;

  const mean = payouts.reduce((s, v) => s + v, 0) / n;

  const variance = payouts.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const se = stdev / Math.sqrt(n);

  const validTurns = turnsUntilOut.filter((v): v is number => v !== null);
  const meanTurns = validTurns.length > 0
    ? validTurns.reduce((s, v) => s + v, 0) / validTurns.length
    : NaN;

  const playWonData = wonRoundData.filter((v): v is boolean => v !== null);
  const wonRoundRate = playWonData.length > 0
    ? playWonData.filter(v => v).length / playWonData.length
    : null;

  return { meanPayout: mean, payoutStdev: stdev, payoutSE: se, meanTurnsUntilOut: meanTurns, wonRoundRate };
}

export function bucketRecords(
  records: readonly DecisionRecord[],
  features: (keyof BucketKey)[],
): BucketStats[] {
  const finalized = records.filter(r => r.outcome !== undefined);
  if (finalized.length === 0) return [];

  const groups = new Map<string, { key: BucketKey; payouts: number[]; turns: (number | null)[]; wonRound: (boolean | null)[] }>();

  for (const record of finalized) {
    const key = buildBucketKey(record, features);
    const ks = keyString(key);
    if (!groups.has(ks)) {
      groups.set(ks, { key, payouts: [], turns: [], wonRound: [] });
    }
    const g = groups.get(ks)!;
    g.payouts.push(record.outcome!.gamePayout);
    g.turns.push(record.outcome!.ownDecisionsUntilOut);
    // Only include wonRound for play-action records
    g.wonRound.push(record.decision.action === 'play' ? record.outcome!.wonRound : null);
  }

  const result: BucketStats[] = [];
  for (const g of groups.values()) {
    const stats = computeStats(g.payouts, g.turns, g.wonRound);
    result.push({ key: g.key, count: g.payouts.length, ...stats });
  }

  result.sort((a, b) => keyString(a.key).localeCompare(keyString(b.key)));

  return result;
}

export function globalMeanPayout(records: readonly DecisionRecord[]): number {
  const finalized = records.filter(r => r.outcome !== undefined);
  if (finalized.length === 0) return 0;
  const sum = finalized.reduce((s, r) => s + r.outcome!.gamePayout, 0);
  return sum / finalized.length;
}

export function rankByPayoutDeviation(
  buckets: readonly BucketStats[],
  globalMean: number,
  minCount = 30,
): BucketStats[] {
  return buckets
    .filter(b => b.count >= minCount)
    .sort((a, b) => {
      const aScore = Math.abs(a.meanPayout - globalMean) * Math.sqrt(a.count);
      const bScore = Math.abs(b.meanPayout - globalMean) * Math.sqrt(b.count);
      return bScore - aScore;
    });
}

function formatKey(key: BucketKey): string {
  const parts: string[] = [];
  for (const k of Object.keys(key).sort() as (keyof BucketKey)[]) {
    parts.push(`${k}=${String(key[k])}`);
  }
  return '{' + parts.join(', ') + '}';
}

export function formatReport(
  buckets: readonly BucketStats[],
  globalMean: number,
): string {
  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  const lines: string[] = [
    '=== Decision Analysis ===',
    `Global mean payout: ${globalMean.toFixed(4)} (n=${totalCount})`,
    '',
    `Top ${Math.min(10, buckets.length)} buckets by deviation:`,
  ];

  const top = buckets.slice(0, 10);
  for (let i = 0; i < top.length; i++) {
    const b = top[i];
    const turnsStr = isNaN(b.meanTurnsUntilOut) ? 'N/A' : b.meanTurnsUntilOut.toFixed(2);
    const wonStr = b.wonRoundRate === null ? 'N/A' : b.wonRoundRate.toFixed(3);
    lines.push(
      `${i + 1}. ${formatKey(b.key)}`,
      `   n=${b.count}   payout=${b.meanPayout.toFixed(4)} ± ${b.payoutSE.toFixed(4)}  σ=${b.payoutStdev.toFixed(4)}  turns_to_out=${turnsStr}  won_round=${wonStr}`,
    );
  }

  return lines.join('\n');
}
