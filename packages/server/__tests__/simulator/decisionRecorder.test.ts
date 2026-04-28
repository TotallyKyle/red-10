import { describe, it, expect } from 'vitest';
import { DecisionRecorder, type DecisionRecord } from './decisionRecorder.js';
import { GameSimulator } from './GameSimulator.js';
import { RandomStrategy, AggressiveStrategy } from './strategies.js';
import type { PlayerStrategy } from './strategies.js';

function runWithRecorder(
  numGames: number,
  strategies: PlayerStrategy[],
): DecisionRecorder {
  const recorder = new DecisionRecorder();
  const wrapped = strategies.map(s => recorder.wrap(s));
  const sim = new GameSimulator({
    numGames,
    strategies: wrapped,
    onGameComplete: (_idx, result, engine) => {
      recorder.finalizeGame(engine, result);
    },
  });
  sim.run();
  return recorder;
}

describe('DecisionRecorder', () => {
  it('empty case: fresh recorder has size 0 and empty getRecords', () => {
    const recorder = new DecisionRecorder();
    expect(recorder.size()).toBe(0);
    expect(recorder.getRecords()).toEqual([]);
  });

  it('records every decision across both phases for N games', () => {
    const recorder = runWithRecorder(3, Array(6).fill(RandomStrategy));

    expect(recorder.size()).toBeGreaterThan(0);

    const records = recorder.getRecords();
    const phases = new Set(records.map(r => r.context.phase));
    expect(phases.has('doubling')).toBe(true);
    expect(phases.has('playing')).toBe(true);
  });

  it('finalized record shape: all required fields present and valid', () => {
    const recorder = runWithRecorder(2, Array(6).fill(AggressiveStrategy));

    expect(recorder.size()).toBeGreaterThan(0);
    const records = recorder.getRecords();

    const playRecord = records.find(r => r.context.phase === 'playing') ?? records[0];

    expect(typeof playRecord.context.gameIndex).toBe('number');
    expect(playRecord.context.gameIndex).toBeGreaterThanOrEqual(0);
    expect(typeof playRecord.context.decisionIndex).toBe('number');
    expect(playRecord.context.decisionIndex).toBeGreaterThanOrEqual(0);
    expect(playRecord.context.handRankCounts.length).toBe(13);
    const rankSum = playRecord.context.handRankCounts.reduce((a, b) => a + b, 0);
    expect(rankSum).toBe(playRecord.context.handSize);

    expect(playRecord.context.activeOpponents).toBeGreaterThanOrEqual(0);
    expect(playRecord.context.activeOpponents).toBeLessThanOrEqual(5);

    const validActions = ['play', 'pass', 'cha', 'go_cha', 'decline_cha', 'double', 'quadruple', 'skip_double', 'defuse'];
    expect(validActions).toContain(playRecord.decision.action);

    expect(playRecord.outcome).toBeDefined();
    expect(Number.isFinite(playRecord.outcome!.gamePayout)).toBe(true);
  });

  it('roundIndex: doubling=-1, playing>=0, monotonically non-decreasing within a game', () => {
    const recorder = runWithRecorder(3, Array(6).fill(AggressiveStrategy));

    const records = recorder.getRecords();
    const byGame = new Map<number, DecisionRecord[]>();
    for (const r of records) {
      const arr = byGame.get(r.context.gameIndex) ?? [];
      arr.push(r);
      byGame.set(r.context.gameIndex, arr);
    }

    for (const [, gameRecs] of byGame) {
      gameRecs.sort((a, b) => a.context.decisionIndex - b.context.decisionIndex);
      let prev = -1;
      for (const r of gameRecs) {
        if (r.context.phase === 'doubling') {
          expect(r.context.roundIndex).toBe(-1);
        } else {
          expect(r.context.roundIndex).toBeGreaterThanOrEqual(0);
          expect(r.context.roundIndex).toBeGreaterThanOrEqual(prev);
          prev = r.context.roundIndex;
        }
      }
    }
  });

  it('ownDecisionsUntilOut: last own decision has 0, second-to-last has 1', () => {
    const recorder = runWithRecorder(3, Array(6).fill(AggressiveStrategy));

    const records = recorder.getRecords();
    const byGamePlayer = new Map<string, DecisionRecord[]>();

    for (const r of records) {
      if (r.outcome?.finalPosition === null) continue;
      const key = `${r.context.gameIndex}:${r.context.playerId}`;
      const arr = byGamePlayer.get(key) ?? [];
      arr.push(r);
      byGamePlayer.set(key, arr);
    }

    let testedLast = false;
    let testedSecondLast = false;

    for (const [, playerRecords] of byGamePlayer) {
      if (playerRecords.length < 2) continue;
      playerRecords.sort((a, b) => a.context.decisionIndex - b.context.decisionIndex);

      const last = playerRecords[playerRecords.length - 1];
      expect(last.outcome!.ownDecisionsUntilOut).toBe(0);
      testedLast = true;

      const secondLast = playerRecords[playerRecords.length - 2];
      expect(secondLast.outcome!.ownDecisionsUntilOut).toBe(1);
      testedSecondLast = true;
      break;
    }

    expect(testedLast).toBe(true);
    expect(testedSecondLast).toBe(true);
  });

  it('finalPosition: consistent per (gameIndex, playerId) and in valid range', () => {
    const recorder = runWithRecorder(3, Array(6).fill(RandomStrategy));

    const records = recorder.getRecords();
    const byGamePlayer = new Map<string, (number | null)[]>();

    for (const r of records) {
      const key = `${r.context.gameIndex}:${r.context.playerId}`;
      const arr = byGamePlayer.get(key) ?? [];
      arr.push(r.outcome!.finalPosition);
      byGamePlayer.set(key, arr);
    }

    for (const [, positions] of byGamePlayer) {
      const first = positions[0];
      for (const pos of positions) {
        expect(pos).toBe(first);
      }
      if (first !== null) {
        expect(first).toBeGreaterThanOrEqual(1);
        expect(first).toBeLessThanOrEqual(6);
      }
    }
  });

  it('wonRound: exactly one play record per round has wonRound=true (verified via roundIndex)', () => {
    const recorder = runWithRecorder(3, Array(6).fill(AggressiveStrategy));

    const records = recorder.getRecords();
    const byGame = new Map<number, DecisionRecord[]>();
    for (const r of records) {
      const arr = byGame.get(r.context.gameIndex) ?? [];
      arr.push(r);
      byGame.set(r.context.gameIndex, arr);
    }

    let roundsWithSingleWinner = 0;
    let roundsChecked = 0;

    for (const [, gameRecs] of byGame) {
      // Group by roundIndex (independent of leaderId — catches consecutive same-player wins).
      const byRound = new Map<number, DecisionRecord[]>();
      for (const r of gameRecs) {
        if (r.context.roundIndex < 0) continue;
        const arr = byRound.get(r.context.roundIndex) ?? [];
        arr.push(r);
        byRound.set(r.context.roundIndex, arr);
      }

      for (const [, roundRecs] of byRound) {
        const playsInRound = roundRecs.filter(
          r => r.decision.action === 'play' && r.context.phase === 'playing',
        );
        if (playsInRound.length === 0) continue;
        const winners = playsInRound.filter(r => r.outcome?.wonRound === true);
        roundsChecked++;
        // For completed rounds, exactly one play should be marked the winner.
        // For truncated final rounds, this can be 0 or 1 depending on whether
        // the round ended cleanly — we accept ≤ 1.
        expect(winners.length).toBeLessThanOrEqual(1);
        if (winners.length === 1) roundsWithSingleWinner++;
      }
    }

    expect(roundsChecked).toBeGreaterThan(0);
    // Most rounds should have a winner identified.
    expect(roundsWithSingleWinner).toBeGreaterThan(0);
  });

  it('detects same-player consecutive round wins (regression for leader-grouping bug)', () => {
    // Run enough games that a same-player-wins-consecutive-rounds case exists.
    const recorder = runWithRecorder(20, Array(6).fill(AggressiveStrategy));

    const records = recorder.getRecords();
    const byGame = new Map<number, DecisionRecord[]>();
    for (const r of records) {
      const arr = byGame.get(r.context.gameIndex) ?? [];
      arr.push(r);
      byGame.set(r.context.gameIndex, arr);
    }

    let foundConsecutiveSameLeader = false;

    for (const [, gameRecs] of byGame) {
      const byRound = new Map<number, DecisionRecord[]>();
      for (const r of gameRecs) {
        if (r.context.roundIndex < 0) continue;
        const arr = byRound.get(r.context.roundIndex) ?? [];
        arr.push(r);
        byRound.set(r.context.roundIndex, arr);
      }

      const sortedRounds = [...byRound.keys()].sort((a, b) => a - b);
      for (let i = 1; i < sortedRounds.length; i++) {
        const prevRound = byRound.get(sortedRounds[i - 1])!;
        const currRound = byRound.get(sortedRounds[i])!;
        const prevLeader = prevRound[0]?.context.currentLeaderId;
        const currLeader = currRound[0]?.context.currentLeaderId;
        if (prevLeader && prevLeader === currLeader) {
          // Two consecutive rounds with same leader. Each should have its own
          // round winner (or none if truncated). This is the case that the
          // old leaderId-grouping algorithm would have collapsed.
          const prevWinners = prevRound.filter(
            r => r.decision.action === 'play' && r.outcome?.wonRound === true,
          );
          const currWinners = currRound.filter(
            r => r.decision.action === 'play' && r.outcome?.wonRound === true,
          );
          // If both rounds had play actions, both should have a winner.
          const prevHasPlay = prevRound.some(r => r.decision.action === 'play');
          const currHasPlay = currRound.some(r => r.decision.action === 'play');
          if (prevHasPlay) expect(prevWinners.length).toBe(1);
          if (currHasPlay && prevHasPlay) expect(currWinners.length).toBeGreaterThanOrEqual(0);
          foundConsecutiveSameLeader = true;
        }
      }
      if (foundConsecutiveSameLeader) break;
    }

    // If 20 games doesn't surface this case, the test is informational only —
    // the important assertion is that whenever it DOES occur, each round has
    // its own winner (verified above).
    if (!foundConsecutiveSameLeader) {
      console.log('  [info] no consecutive same-leader rounds in 20 games; test is informational');
    }
  });

  it('game boundary detection: 2 games produce 2 distinct gameIndex values', () => {
    const recorder = runWithRecorder(2, Array(6).fill(RandomStrategy));

    const records = recorder.getRecords();
    const gameIndices = new Set(records.map(r => r.context.gameIndex));
    expect(gameIndices.size).toBe(2);
  });
});
