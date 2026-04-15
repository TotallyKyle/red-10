import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import type { Card } from '@red10/shared';

// Helper to create a card
function card(rank: string, suit: string, isRed: boolean): Card {
  return { id: `${suit}-${rank}`, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
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

  engine.startNewRound('p0');
  return engine;
}

describe('Straights — game context', () => {
  it('straight can be played as opening (leader sets format)', () => {
    const hands: Card[][] = [
      // p0: 3-4-5 straight
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    const result = engine.playCards('p0', [
      card('3', 'hearts', true),
      card('4', 'hearts', true),
      card('5', 'hearts', true),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('straight');
  });

  it('higher straight of same length beats lower', () => {
    const hands: Card[][] = [
      // p0: 3-4-5
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: 6-7-8
      [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with 3-4-5
    engine.playCards('p0', [
      card('3', 'hearts', true),
      card('4', 'hearts', true),
      card('5', 'hearts', true),
    ]);

    // p1 plays 6-7-8 (higher)
    const result = engine.playCards('p1', [
      card('6', 'hearts', true),
      card('7', 'hearts', true),
      card('8', 'hearts', true),
    ]);
    expect(result.success).toBe(true);
  });

  it('different length straight cannot beat', () => {
    const hands: Card[][] = [
      // p0: 3-4-5
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: 6-7-8-9 (longer straight)
      [
        card('6', 'hearts', true), card('7', 'hearts', true),
        card('8', 'hearts', true), card('9', 'hearts', true),
      ],
      [card('J', 'hearts', true), card('Q', 'hearts', true), card('K', 'hearts', true)],
      [card('A', 'hearts', true), card('2', 'hearts', true), card('3', 'diamonds', true)],
      [card('4', 'diamonds', true), card('5', 'diamonds', true), card('6', 'diamonds', true)],
      [card('7', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with 3-card straight
    engine.playCards('p0', [
      card('3', 'hearts', true),
      card('4', 'hearts', true),
      card('5', 'hearts', true),
    ]);

    // p1 tries 4-card straight — different length, should fail
    const result = engine.playCards('p1', [
      card('6', 'hearts', true),
      card('7', 'hearts', true),
      card('8', 'hearts', true),
      card('9', 'hearts', true),
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not beat');
  });

  it('A-2-3 straight works in game context', () => {
    const hands: Card[][] = [
      // p0: A-2-3 (low straight)
      [card('A', 'hearts', true), card('2', 'hearts', true), card('3', 'hearts', true)],
      [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with A-2-3
    const result = engine.playCards('p0', [
      card('A', 'hearts', true),
      card('2', 'hearts', true),
      card('3', 'hearts', true),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('straight');
  });
});

describe('Paired straights — game context', () => {
  it('paired straight (3-3-4-4-5-5) works as opening', () => {
    const hands: Card[][] = [
      // p0: 3-3-4-4-5-5
      [
        card('3', 'hearts', true), card('3', 'diamonds', true),
        card('4', 'hearts', true), card('4', 'diamonds', true),
        card('5', 'hearts', true), card('5', 'diamonds', true),
      ],
      // p1-p5: enough cards
      [
        card('6', 'hearts', true), card('6', 'diamonds', true),
        card('7', 'hearts', true), card('7', 'diamonds', true),
        card('8', 'hearts', true), card('8', 'diamonds', true),
      ],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'clubs', false), card('4', 'clubs', false), card('5', 'clubs', false)],
      [card('6', 'clubs', false), card('7', 'clubs', false), card('8', 'clubs', false)],
    ];
    const engine = createEngineWithHands(hands);

    const result = engine.playCards('p0', [
      card('3', 'hearts', true), card('3', 'diamonds', true),
      card('4', 'hearts', true), card('4', 'diamonds', true),
      card('5', 'hearts', true), card('5', 'diamonds', true),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('paired_straight');
  });

  it('higher paired straight beats lower of same length', () => {
    const hands: Card[][] = [
      // p0: 3-3-4-4-5-5
      [
        card('3', 'hearts', true), card('3', 'diamonds', true),
        card('4', 'hearts', true), card('4', 'diamonds', true),
        card('5', 'hearts', true), card('5', 'diamonds', true),
      ],
      // p1: 6-6-7-7-8-8
      [
        card('6', 'hearts', true), card('6', 'diamonds', true),
        card('7', 'hearts', true), card('7', 'diamonds', true),
        card('8', 'hearts', true), card('8', 'diamonds', true),
      ],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true), card('2', 'hearts', true)],
      [card('3', 'clubs', false), card('4', 'clubs', false), card('5', 'clubs', false)],
      [card('6', 'clubs', false), card('7', 'clubs', false), card('8', 'clubs', false)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with 3-3-4-4-5-5
    engine.playCards('p0', [
      card('3', 'hearts', true), card('3', 'diamonds', true),
      card('4', 'hearts', true), card('4', 'diamonds', true),
      card('5', 'hearts', true), card('5', 'diamonds', true),
    ]);

    // p1 plays 6-6-7-7-8-8 (higher)
    const result = engine.playCards('p1', [
      card('6', 'hearts', true), card('6', 'diamonds', true),
      card('7', 'hearts', true), card('7', 'diamonds', true),
      card('8', 'hearts', true), card('8', 'diamonds', true),
    ]);
    expect(result.success).toBe(true);
  });
});
