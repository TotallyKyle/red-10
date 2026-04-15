import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import type { Card } from '@red10/shared';

// Helper to create a card
function card(rank: string, suit: string, isRed: boolean): Card {
  return { id: `${suit}-${rank}`, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
}

// Helper with unique IDs for multiple cards of same rank+suit
function cardU(rank: string, suit: string, isRed: boolean, idx: number): Card {
  return { id: `${suit}-${rank}-${idx}`, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
}

// Helper to create a set of players
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
 * Creates a GameEngine with predetermined hands.
 */
function createEngineWithHands(hands: Card[][]): GameEngine {
  const engine = new GameEngine('test-room', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    const hasRed10 = hands[i].some((c) => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
  }

  // Skip doubling phase, go straight to playing
  state.phase = 'playing';
  state.doubling = null;

  engine.startNewRound('p0');
  return engine;
}

describe('Cha-Go — opportunity detection', () => {
  it('single played, another player has pair → cha-go opportunity detected', () => {
    const hands: Card[][] = [
      // p0: has one 7
      [card('7', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: has a pair of 7s
      [card('7', 'diamonds', true), card('7', 'clubs', false), card('8', 'hearts', true)],
      // p2-p5: filler
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays a single 7
    const result = engine.playCards('p0', [card('7', 'hearts', true)]);
    expect(result.success).toBe(true);

    const state = engine.getState();
    expect(state.round?.chaGoState).not.toBeNull();
    expect(state.round?.chaGoState?.triggerRank).toBe('7');
    expect(state.round?.chaGoState?.phase).toBe('waiting_cha');
    expect(state.round?.chaGoState?.eligiblePlayerIds).toContain('p1');
  });

  it('single played, no player has pair → no cha-go, normal play continues', () => {
    const hands: Card[][] = [
      [card('7', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: has one 7 only (not a pair)
      [card('7', 'diamonds', true), card('6', 'clubs', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('7', 'hearts', true)]);

    const state = engine.getState();
    expect(state.round?.chaGoState).toBeNull();
    // Normal play continues — next player is p1
    expect(state.round?.currentPlayerId).toBe('p1');
  });
});

describe('Cha-Go — full sequence', () => {
  it('single → cha (pair) → go (single) → final cha (pair) → round winner', () => {
    // 6 copies of rank 5: p0 has 1, p1 has 2, p2 has 1, p3 has 2
    const hands: Card[][] = [
      // p0: plays the trigger single 5
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: has a pair of 5s — will cha
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      // p2: has one 5 — can play go
      [card('5', 'spades', false), card('J', 'hearts', true), card('Q', 'hearts', true)],
      // p3: has a pair of 5s — can final cha
      [card('5', 'hearts2', true), card('5', 'clubs2', false), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays single 5 — triggers cha-go
    engine.playCards('p0', [card('5', 'hearts', true)]);
    let state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_cha');
    expect(state.round?.chaGoState?.eligiblePlayerIds).toContain('p1');
    expect(state.round?.chaGoState?.eligiblePlayerIds).toContain('p3');

    // p1 cha's with pair of 5s
    const chaResult = engine.cha('p1', [card('5', 'diamonds', true), card('5', 'clubs', false)]);
    expect(chaResult.success).toBe(true);

    state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_go');
    expect(state.round?.chaGoState?.chaPlayerId).toBe('p1');
    // Turn continues clockwise from p1 → p2
    expect(state.round?.currentPlayerId).toBe('p2');

    // p2 plays go (single 5)
    const goResult = engine.playCards('p2', [card('5', 'spades', false)]);
    expect(goResult.success).toBe(true);

    state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_final_cha');
    expect(state.round?.chaGoState?.goPlayerId).toBe('p2');

    // p3 plays final cha (pair of 5s) — wins the round
    const finalChaResult = engine.cha('p3', [card('5', 'hearts2', true), card('5', 'clubs2', false)]);
    expect(finalChaResult.success).toBe(true);

    state = engine.getState();
    // Round ended, new round started with p3 as leader
    expect(state.round?.chaGoState).toBeNull();
    expect(state.round?.leaderId).toBe('p3');
    expect(state.round?.plays).toHaveLength(0);
  });

  it('all players decline cha → normal play resumes', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays single 5
    engine.playCards('p0', [card('5', 'hearts', true)]);
    let state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_cha');
    expect(state.round?.chaGoState?.eligiblePlayerIds).toEqual(['p1']);

    // p1 declines
    const declineResult = engine.declineCha('p1');
    expect(declineResult.success).toBe(true);

    state = engine.getState();
    // Cha-go ended, normal play resumes
    expect(state.round?.chaGoState).toBeNull();
    // Next player after p0
    expect(state.round?.currentPlayerId).toBe('p1');
  });
});

describe('Cha-Go — go-cha (3 of a kind)', () => {
  it('go-cha (3 of trigger rank) auto-wins the round', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1 has 3 copies of 5 plus an extra card — can go-cha without going out
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('5', 'spades', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays single 5
    engine.playCards('p0', [card('5', 'hearts', true)]);
    let state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_cha');

    // p1 has valid actions including go_cha
    const actions = engine.getValidActions('p1');
    expect(actions).toContain('go_cha');
    expect(actions).toContain('cha');

    // p1 plays go-cha with 3 fives
    const result = engine.goCha('p1', [
      card('5', 'diamonds', true),
      card('5', 'clubs', false),
      card('5', 'spades', false),
    ]);
    expect(result.success).toBe(true);

    state = engine.getState();
    // Round over, p1 wins and leads new round
    expect(state.round?.chaGoState).toBeNull();
    expect(state.round?.leaderId).toBe('p1');
    expect(state.round?.plays).toHaveLength(0);
  });
});

describe('Cha-Go — pass handling', () => {
  it('during waiting_go, everyone passes → cha player wins', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: pair of 5s
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      // p2-p5: no 5s
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays single 5
    engine.playCards('p0', [card('5', 'hearts', true)]);

    // p1 cha's
    engine.cha('p1', [card('5', 'diamonds', true), card('5', 'clubs', false)]);

    let state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_go');
    // Turn is at p2 (clockwise from p1)
    expect(state.round?.currentPlayerId).toBe('p2');

    // Everyone passes: p2, p3, p4, p5, p0 (5 passes — all active except p1)
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    engine.pass('p5');
    engine.pass('p0');

    state = engine.getState();
    // p1 (cha player) wins the round
    expect(state.round?.chaGoState).toBeNull();
    expect(state.round?.leaderId).toBe('p1');
    expect(state.round?.plays).toHaveLength(0);
  });

  it('during waiting_final_cha, everyone passes → go player wins', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: pair of 5s — will cha
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      // p2: single 5 — will go
      [card('5', 'spades', false), card('J', 'hearts', true), card('Q', 'hearts', true)],
      // p3: pair of 5s — eligible for final cha, will decline
      [card('5', 'hearts2', true), card('5', 'clubs2', false), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);
    engine.cha('p1', [card('5', 'diamonds', true), card('5', 'clubs', false)]);
    engine.playCards('p2', [card('5', 'spades', false)]);

    let state = engine.getState();
    expect(state.round?.chaGoState?.phase).toBe('waiting_final_cha');

    // p3 declines final cha
    engine.declineCha('p3');

    state = engine.getState();
    // go player (p2) wins
    expect(state.round?.chaGoState).toBeNull();
    expect(state.round?.leaderId).toBe('p2');
  });
});

describe('Cha-Go — optional and validation', () => {
  it('cha-go is optional — player with pair can decline', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);

    // p1 has valid actions to cha or decline
    const actions = engine.getValidActions('p1');
    expect(actions).toContain('cha');
    expect(actions).toContain('decline_cha');

    // p1 declines — it's valid
    const result = engine.declineCha('p1');
    expect(result.success).toBe(true);
  });

  it('only pairs of the TRIGGER RANK can be used to cha', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      // p1: has pair of 5s AND pair of 8s
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true), card('8', 'diamonds', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('9', 'diamonds', true), card('J', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);

    // p1 tries to cha with wrong rank (8s instead of 5s)
    const result = engine.cha('p1', [card('8', 'hearts', true), card('8', 'diamonds', true)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('rank');
  });

  it('wrong rank cha is rejected', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('6', 'clubs', false)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);

    // Try cha with one correct and one wrong rank
    const result = engine.cha('p1', [card('5', 'diamonds', true), card('6', 'clubs', false)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('rank');
  });

  it('non-eligible player cannot cha', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      // p2: no pair of 5s
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);

    // p2 is not eligible to cha (no pair of 5s)
    const result = engine.cha('p2', [card('9', 'hearts', true), card('J', 'hearts', true)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not eligible');
  });
});

describe('Cha-Go — getValidActions', () => {
  it('waiting_cha: eligible player gets cha and decline_cha actions', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);
    engine.playCards('p0', [card('5', 'hearts', true)]);

    const p1Actions = engine.getValidActions('p1');
    expect(p1Actions).toContain('cha');
    expect(p1Actions).toContain('decline_cha');

    // p2 (not eligible) has no actions
    const p2Actions = engine.getValidActions('p2');
    expect(p2Actions).toHaveLength(0);
  });

  it('waiting_go: current player gets play and pass', () => {
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'diamonds', true), card('5', 'clubs', false), card('8', 'hearts', true)],
      [card('5', 'spades', false), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);
    engine.playCards('p0', [card('5', 'hearts', true)]);
    engine.cha('p1', [card('5', 'diamonds', true), card('5', 'clubs', false)]);

    // p2 is next (clockwise from p1), has a 5
    const p2Actions = engine.getValidActions('p2');
    expect(p2Actions).toContain('play');
    expect(p2Actions).toContain('pass');
  });
});

describe('Cha-Go — cha-go only for singles', () => {
  it('pair play does NOT trigger cha-go', () => {
    const hands: Card[][] = [
      // p0: pair of 5s (plays pair, not single)
      [card('5', 'hearts', true), card('5', 'diamonds', true), card('4', 'hearts', true)],
      // p1: also has pair of 5s
      [card('5', 'clubs', false), card('5', 'spades', false), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('6', 'hearts', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays a pair of 5s — should NOT trigger cha-go
    engine.playCards('p0', [card('5', 'hearts', true), card('5', 'diamonds', true)]);

    const state = engine.getState();
    expect(state.round?.chaGoState).toBeNull();
    expect(state.round?.currentFormat).toBe('pair');
  });
});
