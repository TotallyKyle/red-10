import { describe, it } from 'vitest';
import { StrategyEvolver, formatReport } from './StrategyEvolver.js';
import {
  AggressiveStrategy,
  SmartRacerStrategy,
  HandSizeExploiterStrategy,
  TeamCoordinatorStrategy,
} from '../../src/bot/BotManager.js';

describe('Strategy Evolution', () => {
  it('runs baseline analysis (500 games)', () => {
    const strategies = [
      AggressiveStrategy,
      SmartRacerStrategy,
      HandSizeExploiterStrategy,
      TeamCoordinatorStrategy,
      SmartRacerStrategy,
      AggressiveStrategy,
    ];

    const evolver = new StrategyEvolver(strategies);
    const report = evolver.analyze(500);
    console.log(formatReport(report));
  });
});
