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
 * Calls startGame() first to set up the basic state, then overrides hands.
 */
function createEngineWithHands(hands: Card[][]): GameEngine {
  const engine = new GameEngine('test-room', makePlayers());
  // Start game to set up phase, turn order, etc.
  engine.startGame();

  // Override hands with our predetermined cards
  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    // Assign teams based on red 10 ownership
    const hasRed10 = hands[i].some((c) => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
  }

  // Skip doubling phase, go straight to playing
  state.phase = 'playing';
  state.doubling = null;

  // Reset the round to start fresh with our hands
  engine.startNewRound('p0');

  return engine;
}

/** Create a minimal hand for testing: each player gets a few specific cards */
function simpleHands(): Card[][] {
  return [
    // p0: 3h, 4h, 5h (low cards)
    [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'hearts', true)],
    // p1: 6h, 7h, 8h
    [card('6', 'hearts', true), card('7', 'hearts', true), card('8', 'hearts', true)],
    // p2: 9h, 10h(red), Jh
    [card('9', 'hearts', true), card('10', 'hearts', true), card('J', 'hearts', true)],
    // p3: Qh, Kh, Ah
    [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
    // p4: 3d, 4d, 5d
    [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
    // p5: 6d, 7d, 8d
    [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
  ];
}

describe('Round play — singles', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = createEngineWithHands(simpleHands());
  });

  it('leader plays a single, next player plays higher single', () => {
    // p0 leads with 3h
    const result1 = engine.playCards('p0', [card('3', 'hearts', true)]);
    expect(result1.success).toBe(true);

    const state = engine.getState();
    expect(state.round?.currentFormat).toBe('single');
    expect(state.round?.currentPlayerId).toBe('p1');

    // p1 plays 6h (higher than 3)
    const result2 = engine.playCards('p1', [card('6', 'hearts', true)]);
    expect(result2.success).toBe(true);

    expect(engine.getState().round?.currentPlayerId).toBe('p2');
  });

  it('player cannot play lower card than current play', () => {
    // p0 leads with 5h
    engine.playCards('p0', [card('5', 'hearts', true)]);

    // p1 tries to play 6h — that should work
    const result1 = engine.playCards('p1', [card('6', 'hearts', true)]);
    expect(result1.success).toBe(true);

    // p2 tries to play 9h (higher than 6) — should work
    const result2 = engine.playCards('p2', [card('9', 'hearts', true)]);
    expect(result2.success).toBe(true);

    // p3 tries Qh — that's higher than 9, should work
    const result3 = engine.playCards('p3', [card('Q', 'hearts', true)]);
    expect(result3.success).toBe(true);

    // p4 tries 3d — that's lower than Q, should fail
    const result4 = engine.playCards('p4', [card('3', 'diamonds', true)]);
    expect(result4.success).toBe(false);
    expect(result4.error).toContain('does not beat');
  });

  it('all players pass after a play → round winner is the last player who played', () => {
    // p0 leads with 5h
    engine.playCards('p0', [card('5', 'hearts', true)]);

    // Everyone else passes (5 other players)
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    engine.pass('p5');

    // After 5 passes (all other active players), round should end
    // p0 wins the round and becomes leader of next round
    const state = engine.getState();
    expect(state.round).not.toBeNull();
    expect(state.round?.leaderId).toBe('p0');
    // New round — no plays yet
    expect(state.round?.plays).toHaveLength(0);
    expect(state.round?.currentFormat).toBeNull();
  });

  it('leader must play — cannot pass on opening play', () => {
    const result = engine.pass('p0');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Leader must play');
  });

  it('invalid cards (not in hand) are rejected', () => {
    // p0 tries to play a card they don't have
    const result = engine.playCards('p0', [card('K', 'spades', false)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in your hand');
  });

  it('not your turn is rejected', () => {
    const result = engine.playCards('p1', [card('6', 'hearts', true)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not your turn');
  });
});

describe('Round play — pairs', () => {
  let engine: GameEngine;

  beforeEach(() => {
    const hands: Card[][] = [
      // p0: pair of 3s, plus a 5
      [card('3', 'hearts', true), card('3', 'diamonds', true), card('5', 'hearts', true)],
      // p1: pair of 6s, plus a 7
      [card('6', 'hearts', true), card('6', 'diamonds', true), card('7', 'hearts', true)],
      // p2: pair of 9s, plus J
      [card('9', 'hearts', true), card('9', 'diamonds', true), card('J', 'hearts', true)],
      // p3: pair of Qs, plus K
      [card('Q', 'hearts', true), card('Q', 'diamonds', true), card('K', 'hearts', true)],
      // p4: pair of 4s, plus a 5
      [card('4', 'hearts', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      // p5: pair of 8s, plus a 7
      [card('8', 'hearts', true), card('8', 'diamonds', true), card('7', 'diamonds', true)],
    ];
    engine = createEngineWithHands(hands);
  });

  it('leader sets format as pair, others must play pairs', () => {
    // p0 leads with pair of 3s
    const result = engine.playCards('p0', [card('3', 'hearts', true), card('3', 'diamonds', true)]);
    expect(result.success).toBe(true);
    expect(engine.getState().round?.currentFormat).toBe('pair');

    // p1 plays pair of 6s
    const result2 = engine.playCards('p1', [card('6', 'hearts', true), card('6', 'diamonds', true)]);
    expect(result2.success).toBe(true);
  });

  it('player cannot play single on a pairs round', () => {
    // p0 leads with pair of 3s
    engine.playCards('p0', [card('3', 'hearts', true), card('3', 'diamonds', true)]);

    // p1 tries to play a single card
    const result = engine.playCards('p1', [card('7', 'hearts', true)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not beat');
  });

  it('player cannot play lower pair', () => {
    // p0 leads with pair of 3s
    engine.playCards('p0', [card('3', 'hearts', true), card('3', 'diamonds', true)]);

    // p1 plays pair of 6s (higher, works)
    engine.playCards('p1', [card('6', 'hearts', true), card('6', 'diamonds', true)]);

    // p2 plays pair of 9s (higher, works)
    engine.playCards('p2', [card('9', 'hearts', true), card('9', 'diamonds', true)]);

    // p3 tries pair of Qs (higher than 9, works)
    const result = engine.playCards('p3', [card('Q', 'hearts', true), card('Q', 'diamonds', true)]);
    expect(result.success).toBe(true);

    // p4 tries pair of 4s (lower than Q, fails)
    const result2 = engine.playCards('p4', [card('4', 'hearts', true), card('4', 'diamonds', true)]);
    expect(result2.success).toBe(false);
  });
});

describe('Player going out and turn order', () => {
  it('player going out is skipped in turn order', () => {
    const hands: Card[][] = [
      // p0: just one card — will go out immediately
      [card('A', 'hearts', true)],
      // p1: two cards
      [card('3', 'hearts', true), card('4', 'hearts', true)],
      // p2: two cards
      [card('5', 'hearts', true), card('6', 'hearts', true)],
      // p3: two cards
      [card('7', 'hearts', true), card('8', 'hearts', true)],
      // p4: two cards
      [card('9', 'hearts', true), card('10', 'hearts', true)],
      // p5: two cards
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
    ];
    const engine = createEngineWithHands(hands);

    // p0 plays their only card — goes out
    const result = engine.playCards('p0', [card('A', 'hearts', true)]);
    expect(result.success).toBe(true);

    const state = engine.getState();
    const p0 = state.players.find((p) => p.id === 'p0')!;
    expect(p0.isOut).toBe(true);
    expect(p0.finishOrder).toBe(1);
    expect(state.finishOrder).toContain('p0');

    // p0 is now out. Everyone passes to end the round.
    // Turn should be at p1 now
    expect(state.round?.currentPlayerId).toBe('p1');

    // All remaining pass — p0 won the round, but p0 is out so next leader should be next active player
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    // After p4 passes, that's 5 passes (all active remaining: p1-p5) but p0 is out
    // So only 5 active players remain. The last player who played (p0) is out.
    // We need all 5 active players to pass.
    // p1, p2, p3, p4 = 4 passes. Still need p5.

    const stateAfter4 = engine.getState();
    // Should still be in the same round waiting for p5
    expect(stateAfter4.round?.currentPlayerId).toBe('p5');

    engine.pass('p5');

    // Now all 5 active players passed. Round is over.
    const stateAfter5 = engine.getState();
    // p0 won the round but is out, so the next active player after p0 leads
    expect(stateAfter5.round?.leaderId).toBe('p1');
    expect(stateAfter5.round?.plays).toHaveLength(0);
  });

  it('round winner becomes leader of next round', () => {
    const engine = createEngineWithHands(simpleHands());

    // p0 leads with 3
    engine.playCards('p0', [card('3', 'hearts', true)]);
    // p1 plays 6 (beats 3)
    engine.playCards('p1', [card('6', 'hearts', true)]);
    // Everyone else passes
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    engine.pass('p5');
    // After 4 passes (p2-p5), need p0 to pass too (5 remaining active minus the one who played last = p1)
    engine.pass('p0');

    // p1 won the round, should be leader of new round
    const state = engine.getState();
    expect(state.round?.leaderId).toBe('p1');
    expect(state.round?.currentPlayerId).toBe('p1');
  });
});

describe('getClientView', () => {
  it('isMyTurn is true for the current player', () => {
    const engine = createEngineWithHands(simpleHands());

    const viewP0 = engine.getClientView('p0');
    expect(viewP0.isMyTurn).toBe(true);

    const viewP1 = engine.getClientView('p1');
    expect(viewP1.isMyTurn).toBe(false);
  });

  it('validActions includes play but not pass for leader on opening', () => {
    const engine = createEngineWithHands(simpleHands());

    const viewP0 = engine.getClientView('p0');
    expect(viewP0.validActions).toContain('play');
    expect(viewP0.validActions).not.toContain('pass');
  });

  it('validActions includes play and pass for non-opening turns', () => {
    const engine = createEngineWithHands(simpleHands());

    // p0 leads
    engine.playCards('p0', [card('3', 'hearts', true)]);

    const viewP1 = engine.getClientView('p1');
    expect(viewP1.validActions).toContain('play');
    expect(viewP1.validActions).toContain('pass');
  });
});

describe('Scoring team', () => {
  it('first player out sets scoringTeam', () => {
    const hands: Card[][] = [
      [card('A', 'hearts', true)], // p0 goes out first
      [card('3', 'hearts', true), card('4', 'hearts', true)],
      [card('5', 'hearts', true), card('6', 'hearts', true)],
      [card('7', 'hearts', true), card('8', 'hearts', true)],
      [card('9', 'hearts', true), card('10', 'diamonds', true)],
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('A', 'hearts', true)]);

    const state = engine.getState();
    const p0Team = state.players.find((p) => p.id === 'p0')!.team;
    expect(state.scoringTeam).toBe(p0Team);
  });
});

describe('lastRoundWin snapshot', () => {
  it('captures the winning play after everyone passes (normal round end)', () => {
    const hands: Card[][] = [
      [card('A', 'hearts', true), card('3', 'hearts', true)],
      [card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('6', 'hearts', true), card('7', 'hearts', true)],
      [card('8', 'hearts', true), card('9', 'hearts', true)],
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('10', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    expect(engine.getState().lastRoundWin).toBeNull();

    engine.playCards('p0', [card('A', 'hearts', true)]);
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    engine.pass('p5');

    const state = engine.getState();
    expect(state.lastRoundWin).not.toBeNull();
    expect(state.lastRoundWin!.winnerId).toBe('p0');
    expect(state.lastRoundWin!.cards).toHaveLength(1);
    expect(state.lastRoundWin!.cards[0].rank).toBe('A');
    expect(state.lastRoundWin!.format).toBe('single');
    expect(state.lastRoundWin!.endedByChaGo).toBe(false);
    // The new round has reset round.lastPlay to null — without the snapshot
    // the UI would have nothing to render.
    expect(state.round?.lastPlay).toBeNull();
  });

  it("clears the snapshot on the next round's first play", () => {
    const hands: Card[][] = [
      [card('A', 'hearts', true), card('3', 'hearts', true)],
      [card('4', 'hearts', true), card('5', 'hearts', true)],
      [card('6', 'hearts', true), card('7', 'hearts', true)],
      [card('8', 'hearts', true), card('9', 'hearts', true)],
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('10', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('A', 'hearts', true)]);
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    engine.pass('p5');

    expect(engine.getState().lastRoundWin).not.toBeNull();

    // p0 (round winner) leads the next round
    engine.playCards('p0', [card('3', 'hearts', true)]);

    expect(engine.getState().lastRoundWin).toBeNull();
  });

  it('marks endedByChaGo=true when a cha-go resolves the round', () => {
    // p0 leads a 5. p1 chas with a pair of 5s. No one can go (no other
    // singles of 5 available). Everyone passes during waiting_go → cha
    // player (p1) wins via endChaGoRound.
    const hands: Card[][] = [
      [card('5', 'hearts', true), card('A', 'hearts', true)],
      [card('5', 'spades', false), card('5', 'clubs', false), card('K', 'hearts', true)],
      [card('6', 'hearts', true), card('7', 'hearts', true)],
      [card('8', 'hearts', true), card('9', 'hearts', true)],
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'clubs', false), card('10', 'diamonds', true)],
    ];
    const engine = createEngineWithHands(hands);

    engine.playCards('p0', [card('5', 'hearts', true)]);
    engine.cha('p1', [card('5', 'spades', false), card('5', 'clubs', false)]);

    // In waiting_go phase. The current player loops through active players
    // (excluding the cha player p1) and they all pass since no one has a 5.
    // After everyone passes the cha player wins.
    const state0 = engine.getState();
    if (state0.round?.chaGoState?.phase === 'waiting_go') {
      // Pass through every non-cha player, starting from currentPlayerId.
      while (engine.getState().round?.chaGoState?.phase === 'waiting_go') {
        const cur = engine.getState().round!.currentPlayerId;
        engine.pass(cur);
      }
    }

    const state = engine.getState();
    expect(state.lastRoundWin).not.toBeNull();
    expect(state.lastRoundWin!.endedByChaGo).toBe(true);
    expect(state.lastRoundWin!.winnerId).toBe('p1');
    // The pair of 5s is what p1 played to win.
    expect(state.lastRoundWin!.cards.length).toBeGreaterThan(0);
    // The new round has reset round.lastPlay to null.
    expect(state.round?.lastPlay).toBeNull();
  });
});
