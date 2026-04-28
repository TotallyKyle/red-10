import { describe, it, expect } from 'vitest';
import type { Card } from '@red10/shared';
import { evaluateHand } from '../src/bot/handEval.js';

// Weight constants mirrored here so tests read clearly
const STRAIGHT_WEIGHT = 0.5;

function makeHand(spec: string): Card[] {
  const suits: Card['suit'][] = ['hearts', 'diamonds', 'hearts2', 'clubs', 'spades', 'clubs2'];
  const seen: Record<string, number> = {};
  return spec.trim().split(/\s+/).map(rank => {
    const idx = (seen[rank] = (seen[rank] ?? 0) + 1) - 1;
    const suit = suits[idx];
    if (!suit) throw new Error(`Too many ${rank}s in spec`);
    const isRed = ['hearts', 'diamonds', 'hearts2'].includes(suit);
    return { id: `${suit}-${rank}-${idx}`, suit, rank: rank as Card['rank'], isRed };
  });
}

describe('evaluateHand', () => {
  it('1. empty hand', () => {
    const result = evaluateHand([]);
    expect(result.turns).toBe(0);
    expect(result.score).toBeCloseTo(0, 5);
  });

  it('2. single low card (3)', () => {
    const result = evaluateHand(makeHand('3'));
    expect(result.turns).toBe(1);
    // 1.0 + 0.6 * 12/12 = 1.6
    expect(result.score).toBeCloseTo(1.6, 5);
  });

  it('3. single 2 (highest single, no penalty)', () => {
    const result = evaluateHand(makeHand('2'));
    expect(result.turns).toBe(1);
    // 1.0 + 0.6 * 0/12 = 1.0
    expect(result.score).toBeCloseTo(1.0, 5);
  });

  it('4. pair of 3s', () => {
    const result = evaluateHand(makeHand('3 3'));
    expect(result.turns).toBe(1);
    // 1.0 + 0.3 * 12/12 = 1.3
    expect(result.score).toBeCloseTo(1.3, 5);
  });

  it('5. QKA bomb-break case — straight + bomb beats 4 singles', () => {
    // A A A A Q K → straight(Q,K,A) + bomb(A,A,A) = 2 turns, score 0.8
    const result = evaluateHand(makeHand('A A A A Q K'));
    expect(result.turns).toBe(2);
    expect(result.score).toBeCloseTo(0.8, 5);
  });

  it('6. lone-single insight — pair(3,3) + single(7)', () => {
    // 3 3 7 → pair(3,3) + single(7)
    // pair(3): 1.0 + 0.3 * 12/12 = 1.3
    // single(7): rank index 4, 1.0 + 0.6 * (12-4)/12 = 1.0 + 0.6*8/12 = 1.0 + 0.4 = 1.4
    // total score = 2.7, turns = 2
    const result = evaluateHand(makeHand('3 3 7'));
    expect(result.turns).toBe(2);
    // pair(3,3)=1.3 + single(7)=1.4 = 2.7
    expect(result.score).toBeCloseTo(2.7, 5);
  });

  it('7. pure 5-card straight', () => {
    const result = evaluateHand(makeHand('3 4 5 6 7'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('8. low-ace straight (A 2 3)', () => {
    const result = evaluateHand(makeHand('A 2 3'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('9. paired straight (3 3 4 4 5 5)', () => {
    const result = evaluateHand(makeHand('3 3 4 4 5 5'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.4, 5);
  });

  it('10. all bomb-rank — two bombs beat pairs', () => {
    // 3 3 3 4 4 4 → two 3-card bombs = 2 turns, score 0.6
    const result = evaluateHand(makeHand('3 3 3 4 4 4'));
    expect(result.turns).toBe(2);
    expect(result.score).toBeCloseTo(0.6, 5);
  });

  it('11. special 4,4,A bomb — 1 turn', () => {
    const result = evaluateHand(makeHand('4 4 A'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.3, 5);
  });

  it('12. special 4,4,A,A,A bomb — 1 turn', () => {
    const result = evaluateHand(makeHand('4 4 A A A'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.3, 5);
  });

  it('13. mixed mid-game hand (11 cards)', () => {
    // 3 4 5 6 7 K K A A A A
    // optimal: straight(3-7) + bomb(A,A,A,A) + pair(K,K)
    // straight: 0.5
    // bomb(4): 0.3
    // pair(K): rank K = index 10, 1.0 + 0.3*(12-10)/12 = 1.0 + 0.3*2/12 = 1.05
    // total = 0.5 + 0.3 + 1.05 = 1.85, turns = 3
    const result = evaluateHand(makeHand('3 4 5 6 7 K K A A A A'));
    expect(result.turns).toBe(3);
    expect(result.score).toBeCloseTo(1.85, 5);
  });

  it('14. determinism — same hand twice gives identical result', () => {
    const hand = makeHand('5 5 6 7 8 J J A A A');
    const r1 = evaluateHand(hand);
    const r2 = evaluateHand(hand);
    expect(r1.turns).toBe(r2.turns);
    expect(r1.score).toBeCloseTo(r2.score, 10);
  });

  it('15. idempotent straight scoring — straight beats 5 singles', () => {
    const result = evaluateHand(makeHand('3 4 5 6 7'));
    expect(result.score).toBeCloseTo(STRAIGHT_WEIGHT, 5);
  });

  it('16. full 13-rank low-ace straight (A-2-3-...-K)', () => {
    // All 13 distinct ranks, one each → optimal is one 13-card low-ace straight.
    const result = evaluateHand(makeHand('3 4 5 6 7 8 9 10 J Q K A 2'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(STRAIGHT_WEIGHT, 5);
  });

  it('17. low-ace paired straight (A A 2 2 3 3)', () => {
    // 6 cards: pairs of A, 2, 3 form a valid low-ace paired straight.
    const result = evaluateHand(makeHand('A A 2 2 3 3'));
    expect(result.turns).toBe(1);
    expect(result.score).toBeCloseTo(0.4, 5);
  });

  it('18. concurrent calls return correct results (memo not shared)', () => {
    // Interleaved evaluations must not corrupt each other via shared module state.
    const handA = makeHand('3 4 5 6 7');
    const handB = makeHand('A A A A');
    const a1 = evaluateHand(handA);
    const b1 = evaluateHand(handB);
    const a2 = evaluateHand(handA);
    const b2 = evaluateHand(handB);
    expect(a1).toEqual(a2);
    expect(b1).toEqual(b2);
    expect(a1.score).toBeCloseTo(0.5, 5); // straight
    expect(b1.score).toBeCloseTo(0.3, 5); // bomb
  });
});
