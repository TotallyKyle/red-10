import { describe, it, expect } from 'vitest';
import { GameSimulator } from './GameSimulator.js';
import {
  RandomStrategy,
  AggressiveStrategy,
  BomberStrategy,
  ChaGoHunterStrategy,
} from './strategies.js';
import type { PlayerStrategy } from './strategies.js';

const allRandom: PlayerStrategy[] = Array(6).fill(RandomStrategy);
const allAggressive: PlayerStrategy[] = Array(6).fill(AggressiveStrategy);
const allBomber: PlayerStrategy[] = Array(6).fill(BomberStrategy);
const allChaGoHunter: PlayerStrategy[] = Array(6).fill(ChaGoHunterStrategy);

const mixed: PlayerStrategy[] = [
  RandomStrategy,
  AggressiveStrategy,
  BomberStrategy,
  ChaGoHunterStrategy,
  RandomStrategy,
  AggressiveStrategy,
];

describe('Game Simulator', () => {
  it('runs 100 games with random strategies without invariant violations', () => {
    const simulator = new GameSimulator({
      numGames: 100,
      strategies: allRandom,
    });
    const result = simulator.run();

    if (result.violations.length > 0) {
      console.log('VIOLATIONS:', JSON.stringify(result.violations.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log('ERRORS:', result.errors.slice(0, 3).map(e => e.error));
    }

    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.gamesCompleted).toBe(100);
  });

  it('runs 100 games with aggressive strategies', () => {
    const simulator = new GameSimulator({
      numGames: 100,
      strategies: allAggressive,
    });
    const result = simulator.run();

    if (result.violations.length > 0) {
      console.log('VIOLATIONS:', JSON.stringify(result.violations.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log('ERRORS:', result.errors.slice(0, 3).map(e => e.error));
    }

    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.gamesCompleted).toBe(100);
  });

  it('runs 100 games with mixed strategies', () => {
    const simulator = new GameSimulator({
      numGames: 100,
      strategies: mixed,
    });
    const result = simulator.run();

    if (result.violations.length > 0) {
      console.log('VIOLATIONS:', JSON.stringify(result.violations.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log('ERRORS:', result.errors.slice(0, 3).map(e => e.error));
    }

    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.gamesCompleted).toBe(100);
  });

  it('runs 50 games with cha-go hunter to exercise cha-go paths', () => {
    const simulator = new GameSimulator({
      numGames: 50,
      strategies: allChaGoHunter,
    });
    const result = simulator.run();

    if (result.violations.length > 0) {
      console.log('VIOLATIONS:', JSON.stringify(result.violations.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log('ERRORS:', result.errors.slice(0, 3).map(e => e.error));
    }

    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.gamesCompleted).toBe(50);
  });

  it('runs 50 games with bomber strategy to exercise bombs', () => {
    const simulator = new GameSimulator({
      numGames: 50,
      strategies: allBomber,
    });
    const result = simulator.run();

    if (result.violations.length > 0) {
      console.log('VIOLATIONS:', JSON.stringify(result.violations.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log('ERRORS:', result.errors.slice(0, 3).map(e => e.error));
    }

    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.gamesCompleted).toBe(50);
  });

  it('prints statistics summary', () => {
    const simulator = new GameSimulator({
      numGames: 500,
      strategies: mixed,
    });
    const result = simulator.run();

    console.log('=== Simulation Statistics (500 games, mixed strategies) ===');
    console.log(`Games completed: ${result.gamesCompleted}/${result.gamesPlayed}`);
    console.log(`Games failed: ${result.gamesFailed}`);
    console.log(`Violations: ${result.violations.length}`);
    console.log(`Errors: ${result.errors.length}`);
    console.log(`Avg rounds/game: ${result.stats.avgRoundsPerGame.toFixed(1)}`);
    console.log(`Avg actions/game: ${result.stats.avgActionsPerGame.toFixed(1)}`);
    console.log(`Red10 wins: ${result.stats.red10Wins}`);
    console.log(`Black10 wins: ${result.stats.black10Wins}`);
    console.log(`Scoring team failures: ${result.stats.scoringTeamFailures}`);
    console.log(`Doubles occurred: ${result.stats.doublesOccurred}`);
    console.log(`Cha-gos occurred: ${result.stats.chaGosOccurred}`);
    console.log(`Defuses occurred: ${result.stats.defusesOccurred}`);
    console.log(`Bombs played: ${result.stats.bombsPlayed}`);

    expect(result.gamesCompleted).toBe(500);
  });
});
