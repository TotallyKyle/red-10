import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import { GameLogger } from '../src/bot/GameLogger.js';
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
 * Build an engine with predetermined hands, skip doubling, start round from leaderId.
 * Teams are assigned by whether each player holds a red 10.
 */
function createEngineWithHands(hands: Card[][], leaderId = 'p0'): GameEngine {
  const engine = new GameEngine('test-room', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    const hasRed10 = hands[i].some(c => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
  }

  state.phase = 'playing';
  state.doubling = null;

  engine.startNewRound(leaderId);
  return engine;
}

// ---- Test 1: engine state correctness for cha ----

describe('TeamReveal — engine state', () => {
  it('revealedRed10Count increments when cha is played with a red 10', () => {
    // p0 leads a single 10♥ (red), triggering cha-go opportunity for p1 who holds 10♦ 10♣ pair.
    // p1 has a pair of 10s including a red one.
    const red10_h = card('10', 'hearts', true, 'r10-h');
    const red10_d = card('10', 'diamonds', true, 'r10-d');
    const black10_c = card('10', 'clubs', false, 'b10-c');

    const hands: Card[][] = [
      // p0: leads single 10♥ then is out of cha
      [red10_h, card('3', 'spades', false, 'p0-3s')],
      // p1: has pair of 10s (one red) — eligible to cha
      [red10_d, black10_c, card('5', 'spades', false, 'p1-5s')],
      [card('4', 'spades', false, 'p2-4s'), card('6', 'spades', false, 'p2-6s'), card('7', 'spades', false, 'p2-7s')],
      [card('8', 'spades', false, 'p3-8s'), card('9', 'spades', false, 'p3-9s'), card('J', 'spades', false, 'p3-Js')],
      [card('Q', 'spades', false, 'p4-Qs'), card('K', 'spades', false, 'p4-Ks'), card('A', 'spades', false, 'p4-As')],
      [card('2', 'spades', false, 'p5-2s'), card('3', 'hearts', false, 'p5-3h'), card('4', 'hearts', false, 'p5-4h')],
    ];

    const engine = createEngineWithHands(hands, 'p0');

    // p0 plays single 10♥ — triggers cha-go for p1
    const playResult = engine.playCards('p0', [red10_h]);
    expect(playResult.success).toBe(true);

    const chaGoState = engine.getState().round?.chaGoState;
    expect(chaGoState?.phase).toBe('waiting_cha');
    expect(chaGoState?.eligiblePlayerIds).toContain('p1');

    // p1 chas with both 10s (one is red) — revealedRed10Count should increment
    const chaResult = engine.cha('p1', [red10_d, black10_c]);
    expect(chaResult.success).toBe(true);

    const p1State = engine.getState().players.find(p => p.id === 'p1')!;
    expect(p1State.revealedRed10Count).toBeGreaterThan(0);
  });
});

// ---- Tests 2-4: GameLogger annotations ----

describe('TeamReveal — GameLogger annotations', () => {
  it('annotates team reveal on cha containing a red 10', () => {
    const red10_h = card('10', 'hearts', true, 'r10-h');
    const red10_d = card('10', 'diamonds', true, 'r10-d');
    const black10_c = card('10', 'clubs', false, 'b10-c');

    const hands: Card[][] = [
      [red10_h, card('3', 'spades', false, 'p0-3s')],
      [red10_d, black10_c, card('5', 'spades', false, 'p1-5s')],
      [card('4', 'spades', false, 'p2-4s'), card('6', 'spades', false, 'p2-6s'), card('7', 'spades', false, 'p2-7s')],
      [card('8', 'spades', false, 'p3-8s'), card('9', 'spades', false, 'p3-9s'), card('J', 'spades', false, 'p3-Js')],
      [card('Q', 'spades', false, 'p4-Qs'), card('K', 'spades', false, 'p4-Ks'), card('A', 'spades', false, 'p4-As')],
      [card('2', 'spades', false, 'p5-2s'), card('3', 'hearts', false, 'p5-3h'), card('4', 'hearts', false, 'p5-4h')],
    ];

    const engine = createEngineWithHands(hands, 'p0');
    engine.playCards('p0', [red10_h]);

    // Verify cha is eligible before proceeding
    const chaGoState = engine.getState().round?.chaGoState;
    expect(chaGoState?.eligiblePlayerIds).toContain('p1');

    engine.cha('p1', [red10_d, black10_c]);

    const logger = new GameLogger();
    logger.logAction(engine, 'p1', 'cha', [red10_d, black10_c]);

    const formatted = logger.getFormattedLog();
    expect(formatted).toContain('Team revealed:');
    expect(formatted).toContain('Bob');
  });

  it('annotates team reveal on play containing a red 10', () => {
    const red10_h = card('10', 'hearts', true, 'r10-h');

    const hands: Card[][] = [
      [red10_h, card('3', 'spades', false, 'p0-3s')],
      [card('5', 'spades', false, 'p1-5s'), card('6', 'spades', false, 'p1-6s'), card('7', 'spades', false, 'p1-7s')],
      [card('4', 'spades', false, 'p2-4s'), card('8', 'spades', false, 'p2-8s'), card('9', 'spades', false, 'p2-9s')],
      [card('J', 'spades', false, 'p3-Js'), card('Q', 'spades', false, 'p3-Qs'), card('K', 'spades', false, 'p3-Ks')],
      [card('A', 'spades', false, 'p4-As'), card('2', 'spades', false, 'p4-2s'), card('3', 'hearts', false, 'p4-3h')],
      [card('4', 'hearts', false, 'p5-4h'), card('5', 'hearts', false, 'p5-5h'), card('6', 'hearts', false, 'p5-6h')],
    ];

    const engine = createEngineWithHands(hands, 'p0');
    engine.playCards('p0', [red10_h]);

    const logger = new GameLogger();
    logger.logAction(engine, 'p0', 'play', [red10_h]);

    const formatted = logger.getFormattedLog();
    expect(formatted).toContain('Team revealed:');
    expect(formatted).toContain('Alice');
  });

  it('does NOT annotate team reveal when no red 10 is played', () => {
    const nonRed = card('7', 'spades', false, 'p0-7s');

    const hands: Card[][] = [
      [nonRed, card('3', 'spades', false, 'p0-3s')],
      [card('5', 'spades', false, 'p1-5s'), card('6', 'spades', false, 'p1-6s'), card('7', 'hearts', true, 'p1-7h')],
      [card('4', 'spades', false, 'p2-4s'), card('8', 'spades', false, 'p2-8s'), card('9', 'spades', false, 'p2-9s')],
      [card('J', 'spades', false, 'p3-Js'), card('Q', 'spades', false, 'p3-Qs'), card('K', 'spades', false, 'p3-Ks')],
      [card('A', 'spades', false, 'p4-As'), card('2', 'spades', false, 'p4-2s'), card('3', 'hearts', false, 'p4-3h')],
      [card('4', 'hearts', false, 'p5-4h'), card('5', 'hearts', false, 'p5-5h'), card('6', 'hearts', false, 'p5-6h')],
    ];

    const engine = createEngineWithHands(hands, 'p0');
    engine.playCards('p0', [nonRed]);

    const logger = new GameLogger();
    logger.logAction(engine, 'p0', 'play', [nonRed]);

    const formatted = logger.getFormattedLog();
    expect(formatted).not.toContain('Team revealed:');
  });
});
