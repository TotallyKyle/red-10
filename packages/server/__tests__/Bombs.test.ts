import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import type { Card } from '@red10/shared';

// Helper to create a card
function card(rank: string, suit: string, isRed: boolean): Card {
  return { id: `${suit}-${rank}`, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
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

  engine.startNewRound('p0');
  return engine;
}

describe('Bombs — format override', () => {
  it('bomb played on singles round overrides format to bomb', () => {
    const hands: Card[][] = [
      // p0: single 3
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: three 7s (bomb)
      [card('7', 'hearts', true), card('7', 'diamonds', true), card('7', 'clubs', false)],
      // p2-p5: filler
      [card('8', 'hearts', true), card('9', 'hearts', true), card('J', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with single 3
    engine.playCards('p0', [card('3', 'hearts', true)]);
    expect(engine.getState().round?.currentFormat).toBe('single');

    // p1 plays a bomb (three 7s)
    const result = engine.playCards('p1', [
      card('7', 'hearts', true),
      card('7', 'diamonds', true),
      card('7', 'clubs', false),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('bomb');
  });

  it('bigger bomb beats smaller bomb', () => {
    const hands: Card[][] = [
      // p0: three 5s (bomb)
      [card('5', 'hearts', true), card('5', 'diamonds', true), card('5', 'clubs', false)],
      // p1: three 9s (bigger bomb)
      [card('9', 'hearts', true), card('9', 'diamonds', true), card('9', 'clubs', false)],
      // p2-p5: filler
      [card('3', 'hearts', true), card('4', 'hearts', true), card('6', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('7', 'hearts', true), card('8', 'hearts', true), card('J', 'hearts', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with bomb of three 5s
    engine.playCards('p0', [
      card('5', 'hearts', true),
      card('5', 'diamonds', true),
      card('5', 'clubs', false),
    ]);
    expect(engine.getState().round?.currentFormat).toBe('bomb');

    // p1 plays bigger bomb (three 9s)
    const result = engine.playCards('p1', [
      card('9', 'hearts', true),
      card('9', 'diamonds', true),
      card('9', 'clubs', false),
    ]);
    expect(result.success).toBe(true);
  });

  it('4-4-A bomb beats any normal 3-card bomb', () => {
    const hands: Card[][] = [
      // p0: three Kings (bomb)
      [card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false)],
      // p1: 4-4-A (special bomb)
      [card('4', 'hearts', true), card('4', 'diamonds', true), card('A', 'hearts', true)],
      // p2-p5: filler
      [card('3', 'hearts', true), card('5', 'hearts', true), card('6', 'hearts', true)],
      [card('Q', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('3', 'diamonds', true), card('5', 'diamonds', true), card('6', 'diamonds', true)],
      [card('9', 'hearts', true), card('J', 'hearts', true), card('2', 'hearts', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with bomb of three Ks
    engine.playCards('p0', [
      card('K', 'hearts', true),
      card('K', 'diamonds', true),
      card('K', 'clubs', false),
    ]);

    // p1 plays 4-4-A (beats any normal 3-card bomb)
    const result = engine.playCards('p1', [
      card('4', 'hearts', true),
      card('4', 'diamonds', true),
      card('A', 'hearts', true),
    ]);
    expect(result.success).toBe(true);
  });

  it('2 red 10s can be played as a bomb on any format', () => {
    const hands: Card[][] = [
      // p0: single 3
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: 2 red 10s
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('J', 'diamonds', true)],
      // p2-p5: filler
      [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with a single
    engine.playCards('p0', [card('3', 'hearts', true)]);

    // p1 plays 2 red 10s as bomb
    const result = engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('bomb');
    expect(engine.getState().round?.lastPlay?.specialBomb).toBe('red10_2');
  });

  it('3 red 10s beats any other bomb', () => {
    const hands: Card[][] = [
      // p0: four 5s (4-of-a-kind bomb) + extra card
      [
        card('5', 'hearts', true), card('5', 'diamonds', true),
        card('5', 'clubs', false), card('5', 'spades', false),
        card('3', 'hearts', true),
      ],
      // p1: 3 red 10s (ultimate bomb) + extra card
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('10', 'hearts2', true), card('J', 'clubs', false)],
      // p2-p5: filler
      [card('4', 'hearts', true), card('6', 'hearts', true), card('7', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('8', 'hearts', true), card('9', 'hearts', true), card('2', 'hearts', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads with 4-of-a-kind bomb
    engine.playCards('p0', [
      card('5', 'hearts', true), card('5', 'diamonds', true),
      card('5', 'clubs', false), card('5', 'spades', false),
    ]);
    expect(engine.getState().round?.currentFormat).toBe('bomb');

    // p1 plays 3 red 10s — beats everything
    const result = engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
      card('10', 'hearts2', true),
    ]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.lastPlay?.specialBomb).toBe('red10_3');
  });
});

describe('Bombs — red 10 team reveal', () => {
  it('playing red 10 reveals player team', () => {
    const hands: Card[][] = [
      // p0: single 3
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: has 2 red 10s
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('J', 'diamonds', true)],
      // p2-p5: filler
      [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    const stateBefore = engine.getState();
    const p1Before = stateBefore.players.find((p) => p.id === 'p1')!;
    expect(p1Before.revealedRed10Count).toBe(0);

    // p0 leads
    engine.playCards('p0', [card('3', 'hearts', true)]);

    // p1 plays 2 red 10s as a bomb
    engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
    ]);

    const stateAfter = engine.getState();
    const p1After = stateAfter.players.find((p) => p.id === 'p1')!;
    expect(p1After.revealedRed10Count).toBe(2);
    expect(p1After.team).toBe('red10');

    // Client view for another player should show p1's team
    const viewP0 = engine.getClientView('p0');
    const p1View = viewP0.players.find((p) => p.id === 'p1')!;
    expect(p1View.team).toBe('red10');
  });
});

describe('Bombs — defuse', () => {
  it('2 black 10s defuse 2 red 10s, round continues as pairs', () => {
    const hands: Card[][] = [
      // p0: single 3
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: 2 red 10s
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('J', 'diamonds', true)],
      // p2: 2 black 10s (can defuse)
      [card('10', 'clubs', false), card('10', 'spades', false), card('8', 'hearts', true)],
      // p3-p5: filler
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads
    engine.playCards('p0', [card('3', 'hearts', true)]);

    // p1 plays 2 red 10s bomb
    engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
    ]);
    expect(engine.getState().round?.currentFormat).toBe('bomb');

    // p2 defuses with 2 black 10s
    const result = engine.defuse('p2', [
      card('10', 'clubs', false),
      card('10', 'spades', false),
    ]);
    expect(result.success).toBe(true);

    const state = engine.getState();
    expect(state.round?.currentFormat).toBe('pair');
    // The black 10s are now the current play
    expect(state.round?.lastPlay?.cards.length).toBe(2);
    expect(state.round?.lastPlay?.format).toBe('pair');
    // p2's hand should have lost the 2 black 10s
    const p2 = state.players.find((p) => p.id === 'p2')!;
    expect(p2.handSize).toBe(1);
  });

  it('3 black 10s defuse 3 red 10s, round continues as bomb', () => {
    const hands: Card[][] = [
      // p0: cards
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: 3 red 10s + extra card so p1 doesn't go out
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('10', 'hearts2', true), card('J', 'hearts', true)],
      // p2: 3 black 10s + extra card so p2 doesn't go out
      [card('10', 'clubs', false), card('10', 'spades', false), card('10', 'clubs2', false), card('8', 'clubs', false)],
      // p3-p5: filler
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 leads
    engine.playCards('p0', [card('3', 'hearts', true)]);

    // p1 plays 3 red 10s bomb
    engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
      card('10', 'hearts2', true),
    ]);

    // p2 defuses with 3 black 10s
    const result = engine.defuse('p2', [
      card('10', 'clubs', false),
      card('10', 'spades', false),
      card('10', 'clubs2', false),
    ]);
    expect(result.success).toBe(true);

    const state = engine.getState();
    expect(state.round?.currentFormat).toBe('bomb');
    expect(state.round?.lastPlay?.format).toBe('bomb');
    const p2 = state.players.find((p) => p.id === 'p2')!;
    expect(p2.handSize).toBe(1);
  });

  it('invalid defuse (wrong cards) is rejected', () => {
    const hands: Card[][] = [
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('J', 'diamonds', true)],
      // p2: has 1 black 10 + another card (not enough)
      [card('10', 'clubs', false), card('8', 'hearts', true), card('9', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('3', 'hearts', true)]);
    engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
    ]);

    // p2 tries to defuse with only 1 black 10 + a non-10 card
    const result = engine.defuse('p2', [
      card('10', 'clubs', false),
      card('8', 'hearts', true),
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid defuse');
  });

  it('cannot defuse a normal bomb', () => {
    const hands: Card[][] = [
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      // p1: normal 3-of-a-kind bomb
      [card('7', 'hearts', true), card('7', 'diamonds', true), card('7', 'clubs', false)],
      // p2: has black 10s
      [card('10', 'clubs', false), card('10', 'spades', false), card('8', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('3', 'hearts', true)]);
    // p1 plays normal bomb
    engine.playCards('p1', [
      card('7', 'hearts', true),
      card('7', 'diamonds', true),
      card('7', 'clubs', false),
    ]);

    // p2 tries to defuse a normal bomb — should fail
    const result = engine.defuse('p2', [
      card('10', 'clubs', false),
      card('10', 'spades', false),
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Only red 10 bombs');
  });
});

describe('Bombs — defuse appears in validActions', () => {
  it('defuse action available when player has enough black 10s after red 10 bomb', () => {
    const hands: Card[][] = [
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('10', 'hearts', true), card('10', 'diamonds', true), card('J', 'diamonds', true)],
      [card('10', 'clubs', false), card('10', 'spades', false), card('8', 'hearts', true)],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('8', 'diamonds', true), card('9', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('3', 'hearts', true)]);
    engine.playCards('p1', [
      card('10', 'hearts', true),
      card('10', 'diamonds', true),
    ]);

    // p2 has 2 black 10s and the last play was red10_2
    const actions = engine.getValidActions('p2');
    expect(actions).toContain('defuse');
  });
});
