import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import { SmartRacerStrategy, LegacyPreFixesStrategy } from '../src/bot/BotManager.js';
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
    { id: 'p0', name: 'Dave', seatIndex: 0 },
    { id: 'p1', name: 'P1', seatIndex: 1 },
    { id: 'p2', name: 'P2', seatIndex: 2 },
    { id: 'p3', name: 'P3', seatIndex: 3 },
    { id: 'p4', name: 'P4', seatIndex: 4 },
    { id: 'p5', name: 'P5', seatIndex: 5 },
  ];
}

/**
 * Build an engine with p0 (Dave) holding the given hand, and the given
 * cards already in `playedCardHistory` (simulating prior rounds' plays).
 * p0 is set as the leader of a fresh round (so chooseBestOpening fires).
 */
function setupOrphanEngine(p0Hand: Card[], publicHistory: Card[]): GameEngine {
  const engine = new GameEngine('orphan-test', makePlayers());
  engine.startGame();

  const state = engine.getState();

  state.players[0].hand = p0Hand;
  state.players[0].handSize = p0Hand.length;
  state.players[0].team = 'black10';

  for (let i = 1; i < 6; i++) {
    const filler: Card[] = Array.from({ length: 8 }, (_, j) =>
      card('J', 'clubs', false, `filler-${i}-${j}`),
    );
    state.players[i].hand = filler;
    state.players[i].handSize = 8;
    state.players[i].team = 'black10';
  }

  (state as any).doubling = { teamsRevealed: false };
  state.phase = 'playing';

  // Inject played history (the under-test mechanism). Bypasses the public
  // push-on-play API since reconstructing a real game sequence to seed the
  // history would dwarf the test logic.
  (engine as any).playedCardHistory = [...publicHistory];

  engine.startNewRound('p0');

  return engine;
}

describe('Orphan-priority opener bump', () => {
  // Score reference for the Z4QL R3 scenario (hand=6):
  //   Hand: [4♠, 6♦, 7♥2, 8♦, K♦, 2♣2]
  //         Ranks: 4(1), 6(3), 7(4), 8(5), K(10), 2(12)
  //         Straights: 6-7-8 (single 3-card straight)
  //         Orphans (per findOrphanCards): 4♠, K♦, 2♣2
  //
  //   4♠ single — without bump: 10 + orphan(8) + (12-1)*2 = 40
  //   4♠ single — with bump (rank 4 exhausted): 40 + 20 = 60
  //   6-7-8 straight: cards*10=30 + (12-4)*2=16 + straight(5) = 51
  //   K♦ single: 10 + 8 + (12-10)*2 = 22 (no bump, rank K not exhausted)
  //   2♣2 single: 10 + 8 + 0 - 20 (hasTwos penalty) = -2
  //
  //   Without bump: straight(51) > 4♠(40) → straight wins
  //   With bump:    4♠(60)     > straight(51) → 4♠ wins

  it('Z4QL R3 case: orphan 4 beats the 3-card straight when rank 4 is publicly exhausted', () => {
    const p0Hand: Card[] = [
      card('4', 'spades', false, 'p0-4s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'hearts2', true, 'p0-7h2'),
      card('8', 'diamonds', true, 'p0-8d'),
      card('K', 'diamonds', true, 'p0-Kd'),
      card('2', 'clubs2', false, 'p0-2c2'),
    ];
    const publicHistory: Card[] = [
      card('4', 'clubs2', false, 'h-4c2'),
      card('4', 'diamonds', true, 'h-4d'),
      card('4', 'clubs', false, 'h-4c'),
      card('4', 'hearts2', true, 'h-4h2'),
    ];
    const engine = setupOrphanEngine(p0Hand, publicHistory);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(1);
    expect(decision.cards![0].rank).toBe('4');
  });

  it('rank not yet exhausted (only 2 fours played): bot picks the straight, not the orphan', () => {
    const p0Hand: Card[] = [
      card('4', 'spades', false, 'p0-4s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'hearts2', true, 'p0-7h2'),
      card('8', 'diamonds', true, 'p0-8d'),
      card('K', 'diamonds', true, 'p0-Kd'),
      card('2', 'clubs2', false, 'p0-2c2'),
    ];
    const publicHistory: Card[] = [
      card('4', 'clubs2', false, 'h-4c2'),
      card('4', 'diamonds', true, 'h-4d'),
    ];
    const engine = setupOrphanEngine(p0Hand, publicHistory);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(3);
    // The straight 6-7-8
    const ranks = decision.cards!.map(c => c.rank).sort();
    expect(ranks).toEqual(['6', '7', '8']);
  });

  it('high orphan (A): bump does NOT fire — straight is chosen even with 4 Aces public', () => {
    // Same shape as Z4QL but with A♠ replacing 4♠. Rank 'A' is excluded from
    // the bump because the high-card penalty (-10 for Aces) already covers it.
    const p0Hand: Card[] = [
      card('A', 'spades', false, 'p0-As'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'hearts2', true, 'p0-7h2'),
      card('8', 'diamonds', true, 'p0-8d'),
      card('K', 'diamonds', true, 'p0-Kd'),
      card('Q', 'clubs2', false, 'p0-Qc2'),
    ];
    const publicHistory: Card[] = [
      card('A', 'clubs2', false, 'h-Ac2'),
      card('A', 'diamonds', true, 'h-Ad'),
      card('A', 'clubs', false, 'h-Ac'),
      card('A', 'hearts2', true, 'h-Ah2'),
    ];
    const engine = setupOrphanEngine(p0Hand, publicHistory);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    // Should NOT be a single A
    expect(
      decision.cards!.length === 1 && decision.cards![0].rank === 'A',
    ).toBe(false);
  });

  it('orphan-in-straight: 4 is part of a 4-5-6 straight → not an orphan, no bump', () => {
    // findOrphanCards marks any card used in a straight as non-orphan, so the
    // bump's `orphans.has(...)` precondition fails. The straight wins on its
    // own merits.
    const p0Hand: Card[] = [
      card('4', 'spades', false, 'p0-4s'),
      card('5', 'clubs', false, 'p0-5c'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('K', 'diamonds', true, 'p0-Kd'),
      card('2', 'clubs2', false, 'p0-2c2'),
    ];
    const publicHistory: Card[] = [
      card('4', 'clubs2', false, 'h-4c2'),
      card('4', 'diamonds', true, 'h-4d'),
      card('4', 'clubs', false, 'h-4c'),
      card('4', 'hearts2', true, 'h-4h2'),
    ];
    const engine = setupOrphanEngine(p0Hand, publicHistory);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    // Should be the 4-5-6 straight, not a 4♠ single
    expect(decision.cards!.length).toBeGreaterThanOrEqual(3);
    const ranks = decision.cards!.map(c => c.rank).sort();
    expect(ranks).toContain('4');
    expect(ranks).toContain('5');
    expect(ranks).toContain('6');
  });

  it('flag-disabled (LegacyPreFixes): same Z4QL hand → bot reverts to straight', () => {
    const p0Hand: Card[] = [
      card('4', 'spades', false, 'p0-4s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'hearts2', true, 'p0-7h2'),
      card('8', 'diamonds', true, 'p0-8d'),
      card('K', 'diamonds', true, 'p0-Kd'),
      card('2', 'clubs2', false, 'p0-2c2'),
    ];
    const publicHistory: Card[] = [
      card('4', 'clubs2', false, 'h-4c2'),
      card('4', 'diamonds', true, 'h-4d'),
      card('4', 'clubs', false, 'h-4c'),
      card('4', 'hearts2', true, 'h-4h2'),
    ];
    const engine = setupOrphanEngine(p0Hand, publicHistory);
    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    // Without the bump, the straight (6-7-8) outscores the 4♠ single
    expect(decision.cards!.length).toBe(3);
    const ranks = decision.cards!.map(c => c.rank).sort();
    expect(ranks).toEqual(['6', '7', '8']);
  });

  it('engine integration: real plays accumulate into playedCardHistory across rounds', () => {
    // Sanity check that the engine push-sites actually populate the history.
    // We don't need a full game — just confirm pushes occur on play().
    const engine = new GameEngine('integration-test', makePlayers());
    engine.startGame();
    const state = engine.getState();

    // Manually rig p0's hand to a known single, set up to lead a round
    const p0Hand: Card[] = [card('5', 'spades', false, 'p0-5s')];
    state.players[0].hand = p0Hand;
    state.players[0].handSize = 1;
    for (let i = 1; i < 6; i++) {
      const filler: Card[] = Array.from({ length: 5 }, (_, j) =>
        card('J', 'clubs', false, `int-filler-${i}-${j}`),
      );
      state.players[i].hand = filler;
      state.players[i].handSize = 5;
    }
    (state as any).doubling = { teamsRevealed: false };
    state.phase = 'playing';
    engine.startNewRound('p0');

    expect(engine.getPlayedCardHistory().length).toBe(0);

    const result = engine.playCards('p0', [p0Hand[0]]);
    expect(result.success).toBe(true);
    expect(engine.getPlayedCardHistory().length).toBe(1);
    expect(engine.getPlayedCardHistory()[0].rank).toBe('5');
  });
});
