import { describe, it, expect } from 'vitest';
import { createDeck, shuffle, deal } from '../src/game/Deck.js';

/**
 * Documents the expected red-10-team-size distribution.
 *
 * Game reviews flagged 13 of 30 games (43%) as 2v4 splits and asked whether
 * this was a deal bug. It isn't — the math:
 *
 *   3 red 10s among 6 players' 13-card hands → distinct-holder count is
 *   the team size on the red10 side.
 *
 *   P(3 distinct holders → 3v3): 65/77 × 52/76 ≈ 57.75%
 *   P(1 distinct holder  → 1v5): 12/77 × 11/76 ≈ 2.26%
 *   P(2 distinct holders → 2v4): the rest ≈ 40.0%
 *
 * 43% / 30 is within sampling variance of 40% expected.
 *
 * This test runs many deals and asserts the empirical distribution lands
 * near the theoretical values. Not a bug check — a "this is by design"
 * regression guard.
 */
describe('Deal — red 10 team-size distribution', () => {
  it('matches theoretical distribution (P(2v4) ≈ 40%)', () => {
    const N = 5000;
    let count1v5 = 0;
    let count2v4 = 0;
    let count3v3 = 0;

    for (let i = 0; i < N; i++) {
      const hands = deal(shuffle(createDeck()));
      const distinctRedTenHolders = hands
        .map(hand => hand.some(c => c.rank === '10' && c.isRed) ? 1 : 0)
        .reduce((a: number, b: number) => a + b, 0);
      if (distinctRedTenHolders === 1) count1v5++;
      else if (distinctRedTenHolders === 2) count2v4++;
      else if (distinctRedTenHolders === 3) count3v3++;
    }

    const p1v5 = count1v5 / N;
    const p2v4 = count2v4 / N;
    const p3v3 = count3v3 / N;

    // Allow ±3% tolerance on each (Wilson interval for N=5000 at p≈0.4 is
    // roughly ±1.4%; we use 3% for headroom against test flakes).
    expect(p1v5).toBeGreaterThan(0.005);
    expect(p1v5).toBeLessThan(0.05);
    expect(p2v4).toBeGreaterThan(0.37);
    expect(p2v4).toBeLessThan(0.43);
    expect(p3v3).toBeGreaterThan(0.545);
    expect(p3v3).toBeLessThan(0.61);

    // Sanity: probabilities sum to 1 across the three categories (no edge case
    // produces 0 distinct holders since there are 3 red 10s in the deck).
    expect(p1v5 + p2v4 + p3v3).toBeCloseTo(1.0, 5);
  });
});
