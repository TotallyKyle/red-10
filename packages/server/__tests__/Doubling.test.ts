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
 * Creates a GameEngine with predetermined hands in doubling phase.
 * Calls startGame() to set up the basic state, then overrides hands/teams.
 */
function createEngineWithHands(hands: Card[][]): GameEngine {
  const engine = new GameEngine('test-room', makePlayers());
  engine.startGame();

  // Override hands with our predetermined cards
  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    // Assign teams based on red 10 ownership
    const hasRed10 = hands[i].some((c) => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
    // Reset any revealed state from startGame
    state.players[i].revealedRed10Count = 0;
  }

  return engine;
}

/**
 * Hands where:
 * - p0: has 3 Kings (bomb) + other cards -> black10 team
 * - p1: has red 10 (hearts) + other cards -> red10 team
 * - p2: has red 10 (diamonds) + other cards -> red10 team
 * - p3: has 4 Aces (bomb) + other cards -> black10 team
 * - p4: has red 10 (hearts2) + other cards -> red10 team
 * - p5: has normal cards -> black10 team
 */
function doublingHands(): Card[][] {
  return [
    // p0: black10 team - has 3 Kings (a bomb)
    [
      card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      card('3', 'hearts', true), card('4', 'hearts', true),
    ],
    // p1: red10 team - has 1 red 10
    [
      card('10', 'hearts', true), card('5', 'clubs', false), card('6', 'clubs', false),
      card('7', 'clubs', false), card('8', 'clubs', false),
    ],
    // p2: red10 team - has 1 red 10
    [
      card('10', 'diamonds', true), card('9', 'clubs', false), card('J', 'clubs', false),
      card('Q', 'clubs', false), card('A', 'clubs', false),
    ],
    // p3: black10 team - has 4 Aces (a bomb)
    [
      card('A', 'hearts', true), card('A', 'diamonds', true), card('A', 'spades', false),
      card('A', 'clubs2', false), card('3', 'clubs', false),
    ],
    // p4: red10 team - has 1 red 10
    [
      card('10', 'hearts2', true), card('2', 'clubs', false), card('2', 'hearts', true),
      card('5', 'hearts', true), card('6', 'hearts', true),
    ],
    // p5: black10 team - no red 10, no bomb
    [
      card('7', 'hearts', true), card('8', 'hearts', true), card('9', 'hearts', true),
      card('J', 'hearts', true), card('Q', 'hearts', true),
    ],
  ];
}

/**
 * Hands where p1 has 2 red 10s
 */
function handsWithDoubleRed10(): Card[][] {
  const hands = doublingHands();
  // Give p1 two red 10s
  hands[1] = [
    card('10', 'hearts', true), card('10', 'diamonds', true), card('6', 'clubs', false),
    card('7', 'clubs', false), card('8', 'clubs', false),
  ];
  // p2 no longer has a red 10
  hands[2] = [
    card('9', 'clubs', false), card('J', 'clubs', false),
    card('Q', 'clubs', false), card('A', 'clubs', false), card('3', 'diamonds', true),
  ];
  return hands;
}

describe('Doubling Phase', () => {
  describe('Phase initialization', () => {
    it('starts in doubling phase after startGame()', () => {
      const engine = createEngineWithHands(doublingHands());
      const state = engine.getState();
      expect(state.phase).toBe('doubling');
      expect(state.doubling).not.toBeNull();
      expect(state.doubling!.currentBidderId).toBe('p0'); // seat 0 starts
      expect(state.doubling!.isDoubled).toBe(false);
      expect(state.doubling!.isQuadrupled).toBe(false);
      expect(state.stakeMultiplier).toBe(1);
    });

    it('provides double/skip_double actions to current bidder', () => {
      const engine = createEngineWithHands(doublingHands());
      const actions = engine.getValidActions('p0');
      expect(actions).toContain('double');
      expect(actions).toContain('skip_double');
    });

    it('provides no actions to non-current bidder', () => {
      const engine = createEngineWithHands(doublingHands());
      expect(engine.getValidActions('p1')).toEqual([]);
      expect(engine.getValidActions('p2')).toEqual([]);
    });
  });

  describe('Nobody doubles', () => {
    it('transitions to playing after all players skip', () => {
      const engine = createEngineWithHands(doublingHands());

      // All 6 players skip
      for (let i = 0; i < 6; i++) {
        const result = engine.skipDouble(`p${i}`);
        expect(result.success).toBe(true);
      }

      const state = engine.getState();
      expect(state.phase).toBe('playing');
      expect(state.stakeMultiplier).toBe(1);
      expect(state.round).not.toBeNull();
    });

    it('keeps teams hidden when nobody doubles', () => {
      const engine = createEngineWithHands(doublingHands());

      for (let i = 0; i < 6; i++) {
        engine.skipDouble(`p${i}`);
      }

      // Check that teams are not revealed in client view
      const view = engine.getClientView('p0');
      // p0 can see their own team
      expect(view.myTeam).toBe('black10');
      // Other players' teams should be hidden
      const p1View = view.players.find((p) => p.id === 'p1');
      expect(p1View!.team).toBeNull();
    });
  });

  describe('Red 10 player doubles', () => {
    it('reveals all red 10s and sets stakes to $2', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 skips
      engine.skipDouble('p0');

      // p1 (red10 team) doubles - no bomb needed
      const result = engine.declareDouble('p1');
      expect(result.success).toBe(true);

      const state = engine.getState();
      expect(state.doubling!.isDoubled).toBe(true);
      expect(state.doubling!.doublerTeam).toBe('red10');
      expect(state.stakeMultiplier).toBe(2);
      expect(state.doubling!.teamsRevealed).toBe(true);

      // All red 10 holders should have their red 10s revealed
      const p1 = state.players.find((p) => p.id === 'p1')!;
      expect(p1.revealedRed10Count).toBe(1);
      const p2 = state.players.find((p) => p.id === 'p2')!;
      expect(p2.revealedRed10Count).toBe(1);
      const p4 = state.players.find((p) => p.id === 'p4')!;
      expect(p4.revealedRed10Count).toBe(1);
    });

    it('reveals multiple red 10s when player has more than one', () => {
      const engine = createEngineWithHands(handsWithDoubleRed10());

      engine.skipDouble('p0');

      const result = engine.declareDouble('p1');
      expect(result.success).toBe(true);

      const state = engine.getState();
      const p1 = state.players.find((p) => p.id === 'p1')!;
      expect(p1.revealedRed10Count).toBe(2);
    });

    it('sets opposing team (black10) as next bidder for quadruple', () => {
      const engine = createEngineWithHands(doublingHands());

      engine.skipDouble('p0');
      engine.declareDouble('p1');

      const state = engine.getState();
      const doubling = state.doubling!;
      // The current bidder should be a black10 team member
      const currentBidder = state.players.find((p) => p.id === doubling.currentBidderId)!;
      expect(currentBidder.team).toBe('black10');
    });

    it('shows quadruple/skip_double actions to opposing team', () => {
      const engine = createEngineWithHands(doublingHands());

      engine.skipDouble('p0');
      engine.declareDouble('p1');

      const state = engine.getState();
      const currentBidderId = state.doubling!.currentBidderId;
      const actions = engine.getValidActions(currentBidderId);
      expect(actions).toContain('quadruple');
      expect(actions).toContain('skip_double');
    });
  });

  describe('Black 10 player doubles with valid bomb', () => {
    it('records revealed bomb and sets stakes to $2', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 (black10 team) doubles with 3 Kings
      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      const result = engine.declareDouble('p0', bombCards);
      expect(result.success).toBe(true);

      const state = engine.getState();
      expect(state.doubling!.isDoubled).toBe(true);
      expect(state.doubling!.doublerTeam).toBe('black10');
      expect(state.stakeMultiplier).toBe(2);
      expect(state.doubling!.revealedBombs).toHaveLength(1);
      expect(state.doubling!.revealedBombs[0].playerId).toBe('p0');
      expect(state.doubling!.revealedBombs[0].cards).toHaveLength(3);
    });

    it('also reveals all red 10s and sets teamsRevealed', () => {
      const engine = createEngineWithHands(doublingHands());

      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      const state = engine.getState();
      expect(state.doubling!.teamsRevealed).toBe(true);

      // All red 10 holders revealed
      expect(state.players.find((p) => p.id === 'p1')!.revealedRed10Count).toBe(1);
      expect(state.players.find((p) => p.id === 'p2')!.revealedRed10Count).toBe(1);
      expect(state.players.find((p) => p.id === 'p4')!.revealedRed10Count).toBe(1);
    });

    it('sets opposing team (red10) as next bidder for quadruple', () => {
      const engine = createEngineWithHands(doublingHands());

      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      const state = engine.getState();
      const currentBidder = state.players.find((p) => p.id === state.doubling!.currentBidderId)!;
      expect(currentBidder.team).toBe('red10');
    });
  });

  describe('Black 10 player tries to double without bomb', () => {
    it('rejects double without bomb cards', () => {
      const engine = createEngineWithHands(doublingHands());

      const result = engine.declareDouble('p0');
      expect(result.success).toBe(false);
      expect(result.error).toContain('bomb');
    });

    it('rejects double with empty bomb cards array', () => {
      const engine = createEngineWithHands(doublingHands());

      const result = engine.declareDouble('p0', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('bomb');
    });
  });

  describe('Black 10 player tries to double with invalid bomb', () => {
    it('rejects cards that do not form a bomb', () => {
      const engine = createEngineWithHands(doublingHands());

      // Only 2 Kings is not a bomb (need at least 3 of a kind for bomb)
      const invalidBomb = [
        card('K', 'hearts', true), card('K', 'diamonds', true),
      ];
      const result = engine.declareDouble('p0', invalidBomb);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not form a valid bomb');
    });

    it('rejects random cards that are not a bomb', () => {
      const engine = createEngineWithHands(doublingHands());

      const invalidBomb = [
        card('K', 'hearts', true), card('3', 'hearts', true), card('4', 'hearts', true),
      ];
      const result = engine.declareDouble('p0', invalidBomb);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not form a valid bomb');
    });
  });

  describe('Black 10 player tries to double with cards not in hand', () => {
    it('rejects cards not in the player hand', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 doesn't have Aces
      const notInHand = [
        card('A', 'hearts', true), card('A', 'diamonds', true), card('A', 'clubs', false),
      ];
      const result = engine.declareDouble('p0', notInHand);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in your hand');
    });
  });

  describe('Quadruple by opposing team', () => {
    it('sets stakes to $4 and transitions to playing', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 (black10) doubles with 3 Kings
      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      // Now an opposing (red10) team member should quadruple
      const state = engine.getState();
      const bidderId = state.doubling!.currentBidderId;
      const bidder = state.players.find((p) => p.id === bidderId)!;
      expect(bidder.team).toBe('red10');

      const result = engine.declareQuadruple(bidderId);
      expect(result.success).toBe(true);

      const finalState = engine.getState();
      expect(finalState.phase).toBe('playing');
      expect(finalState.stakeMultiplier).toBe(4);
      expect(finalState.round).not.toBeNull();
    });
  });

  describe('All opposing skip quadruple', () => {
    it('stays at $2 and transitions to playing', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 (black10) doubles
      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      // All red10 team members skip quadruple
      // The opposing team is red10: p1, p2, p4
      let state = engine.getState();
      let iterations = 0;
      while (state.phase === 'doubling' && iterations < 10) {
        const bidderId = state.doubling!.currentBidderId;
        const result = engine.skipQuadruple(bidderId);
        expect(result.success).toBe(true);
        state = engine.getState();
        iterations++;
      }

      expect(state.phase).toBe('playing');
      expect(state.stakeMultiplier).toBe(2);
      expect(state.round).not.toBeNull();
    });
  });

  describe('Wrong player tries to double', () => {
    it('rejects double from non-current bidder', () => {
      const engine = createEngineWithHands(doublingHands());

      // p1 tries to double but it's p0's turn
      const result = engine.declareDouble('p1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not your turn');
    });

    it('rejects skip from non-current bidder', () => {
      const engine = createEngineWithHands(doublingHands());

      const result = engine.skipDouble('p3');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not your turn');
    });
  });

  describe('Player on same team as doubler cannot quadruple', () => {
    it('rejects quadruple from same team', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 (black10) doubles
      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      // p3 is also black10 — should not be able to quadruple
      const result = engine.declareQuadruple('p3');
      expect(result.success).toBe(false);
      expect(result.error).toContain('opposing team');
    });
  });

  describe('Client view during doubling', () => {
    it('includes doubling state in client view', () => {
      const engine = createEngineWithHands(doublingHands());

      const view = engine.getClientView('p0');
      expect(view.phase).toBe('doubling');
      expect(view.doubling).not.toBeNull();
      expect(view.doubling!.currentBidderId).toBe('p0');
      expect(view.isMyTurn).toBe(true);
    });

    it('shows teams after doubling reveals them', () => {
      const engine = createEngineWithHands(doublingHands());

      // p0 doubles
      const bombCards = [
        card('K', 'hearts', true), card('K', 'diamonds', true), card('K', 'clubs', false),
      ];
      engine.declareDouble('p0', bombCards);

      // After doubling, teams should be visible in client view
      const view = engine.getClientView('p5'); // p5 is black10
      const p1View = view.players.find((p) => p.id === 'p1');
      expect(p1View!.team).toBe('red10');
      const p0View = view.players.find((p) => p.id === 'p0');
      expect(p0View!.team).toBe('black10');
    });

    it('isMyTurn is true for current bidder', () => {
      const engine = createEngineWithHands(doublingHands());

      expect(engine.getClientView('p0').isMyTurn).toBe(true);
      expect(engine.getClientView('p1').isMyTurn).toBe(false);
    });
  });
});
