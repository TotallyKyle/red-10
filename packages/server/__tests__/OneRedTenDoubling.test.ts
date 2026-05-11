import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import {
  SmartRacerStrategy,
  LegacyPreFixesStrategy,
} from '../src/bot/BotManager.js';
import type { Card } from '@red10/shared';

function card(rank: string, suit: string, isRed: boolean, id?: string): Card {
  return {
    id: id ?? `${suit}-${rank}`,
    suit: suit as Card['suit'],
    rank: rank as Card['rank'],
    isRed,
  };
}

function makePlayers() {
  return [
    { id: 'p0', name: 'Alice', seatIndex: 0 },
    { id: 'p1', name: 'Bob', seatIndex: 1 },
    { id: 'p2', name: 'Charlie', seatIndex: 2 },
    { id: 'p3', name: 'Dave', seatIndex: 3 },
    { id: 'p4', name: 'Eve', seatIndex: 4 },
    { id: 'p5', name: 'Frank', seatIndex: 5 },
  ];
}

/**
 * Build an engine in doubling phase with custom hands assigned to each player.
 * Teams are derived from red 10 ownership so the engine team assignment mirrors
 * what createEngineWithHands does in Doubling.test.ts.
 *
 * IMPORTANT: The first doubling turn always goes to p0 (seat 0 / turnOrder[0]).
 * Test subject must always be p0 so that getValidActions returns ['double', 'skip_double'].
 */
function setupDoublingEngine(hands: Card[][]): GameEngine {
  const engine = new GameEngine('one-red-ten-test', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    const hasRed10 = hands[i].some(c => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
    state.players[i].revealedRed10Count = 0;
  }

  return engine;
}

// Filler hands with unique card IDs to avoid collisions.
// None hold red 10s so these players are assigned team black10.
const fillerA: Card[] = [
  card('5', 'clubs', false, 'fa-5c'),
  card('6', 'clubs', false, 'fa-6c'),
  card('8', 'clubs', false, 'fa-8c'),
];
const fillerB: Card[] = [
  card('5', 'spades', false, 'fb-5s'),
  card('6', 'spades', false, 'fb-6s'),
  card('8', 'spades', false, 'fb-8s'),
];
const fillerC: Card[] = [
  card('5', 'diamonds', true, 'fc-5d'),
  card('6', 'diamonds', true, 'fc-6d'),
  card('8', 'diamonds', true, 'fc-8d'),
];

// Filler that contributes exactly 1 red 10 (for building a 3v3 team layout).
// Uses unique IDs keyed by suffix to avoid cross-test collisions.
function red10Filler(suffix: string): Card[] {
  return [
    card('10', 'hearts', true, `r10-10h-${suffix}`),
    card('5', 'clubs', false, `r10-5c-${suffix}`),
    card('6', 'clubs', false, `r10-6c-${suffix}`),
  ];
}

// ---- Probabilistic 2v4 doubling penalty (1 red 10) ----

describe('Probabilistic 2v4 doubling penalty — 1 red 10 holder', () => {
  it('Test 1: borderline — 1 red 10 + 7×4 (strength=9, threshold=9) → skip with +0.4 penalty', () => {
    // p0 is the test subject (first doubling turn).
    // Hand: 1 red 10 + 7×4 + 1 filler.
    // evaluateHandStrength:
    //   bombRanks={7} → +3 (first bomb)
    //   hasFourPlusBomb (7×4 ≥ 4) → +2
    //   groups={10,7,3} size=3 ≤4 → +4
    //   Total = 9
    // Without penalty: strength(9) ≥ threshold(9) AND hasStrongStructure → would double.
    // +0.4 penalty: effectiveThreshold=9.4. strength(9) < 9.4 → skip.
    // Team layout: p0 + p1 + p2 hold red 10s → 3v3.
    // isProbabilistic2v4=true: !isKnown2v4(p0 holds 1, not 2), redTensHeld=1, team='red10'.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
    ];

    const hands: Card[][] = [
      p0Hand,
      red10Filler('p1'),   // red10 team member
      red10Filler('p2'),   // red10 team member
      fillerA,
      fillerB,
      fillerC,
    ];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('skip');
  });

  it('Test 2: above threshold — 1 red 10 + 7×4 + Q×3 (strength=10) → double despite +0.4 penalty', () => {
    // p0 is the test subject (first doubling turn).
    // Hand: 1 red 10 + 7×4 + Q×3 + 1 filler.
    // evaluateHandStrength:
    //   bombRanks={7,Q} → +3 (first bomb) + 4 (second bomb) = 7
    //   hasFourPlusBomb (7×4 ≥ 4) → +2
    //   groups={10,7,Q,3} size=4 ≤4 → +4
    //   Total = 13, capped at 10
    // +0.4 penalty: effectiveThreshold=9.4. strength(10) ≥ 9.4 AND hasStrongStructure → double.
    // red10 doublers don't need bombCards.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('Q', 'hearts', true, 'p0-Qh'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('Q', 'clubs', false, 'p0-Qc'),
      card('3', 'clubs', false, 'p0-3c'),
    ];

    const hands: Card[][] = [
      p0Hand,
      red10Filler('p1'),
      red10Filler('p2'),
      fillerA,
      fillerB,
      fillerC,
    ];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });

  it('Test 3: Legacy bypass — same hand as Test 1, LegacyPreFixesStrategy → double', () => {
    // Same hand/team as Test 1 (strength=9, effectiveThreshold=9 after bypassing +0.4 penalty).
    // LegacyPreFixesStrategy passes disable1RedTenDoublingPenalty: true →
    // isProbabilistic2v4=false → effectiveThreshold=9. strength(9) ≥ 9 → double.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
    ];

    const hands: Card[][] = [
      p0Hand,
      red10Filler('p1'),
      red10Filler('p2'),
      fillerA,
      fillerB,
      fillerC,
    ];
    const engine = setupDoublingEngine(hands);

    const decision = LegacyPreFixesStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });

  it('Test 4: black10 player (0 red 10s) + 7×4 (strength=9) → double (no penalty)', () => {
    // p0 has 0 red 10s → team=black10. No probabilistic penalty (team!=='red10').
    // evaluateHandStrength: bombRanks={7} → +3; hasFourPlusBomb → +2; groups={7,3,4} size=3 ≤4 → +4
    // Total = 9. effectiveThreshold=9. strength(9) ≥ 9 AND hasStrongStructure → double.
    // black10 doublers must reveal a bomb → bombCards=[7,7,7,7].
    // p1, p2, p3 hold red 10s so the engine has valid team assignments.
    const p0Hand: Card[] = [
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
      card('4', 'clubs', false, 'p0-4c'),
    ];

    const hands: Card[][] = [
      p0Hand,
      red10Filler('p1'),
      red10Filler('p2'),
      red10Filler('p3'),
      fillerA,
      fillerB,
    ];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
    // black10 doublers must provide a bomb to reveal
    expect(decision.bombCards).toBeDefined();
    expect(decision.bombCards!.length).toBeGreaterThanOrEqual(3);
  });

  it('Test 5: 2 red 10s + 7×4 (strength=9) → skip (deterministic 2v4 penalty unchanged)', () => {
    // p0 holds 2 red 10s + 7×4 + 1 filler.
    // evaluateHandStrength: bomb(+3) + fourPlusBomb(+2) + density≤4(+4) = 9.
    // isKnown2v4=true (2 red 10s) → effectiveThreshold=10, hasStrongStructure requires
    // distinctBombRanks≥2 (only 1 here, 7×4) → false.
    // strength(9) < 10 AND hasStrongStructure=false → skip.
    // Team layout: p0 holds 2 red 10s; p1 holds 1 → total 3 red 10s (2v4 team).
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('10', 'diamonds', true, 'p0-10d'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
    ];

    const hands: Card[][] = [
      p0Hand,
      red10Filler('p1'),   // holds the 3rd red 10
      fillerA,
      fillerB,
      fillerC,
      [
        card('5', 'hearts', true, 'p5-5h'),
        card('6', 'hearts', true, 'p5-6h'),
        card('8', 'hearts', true, 'p5-8h'),
      ],
    ];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('skip');
  });
});
