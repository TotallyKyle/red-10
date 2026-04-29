import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';

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

function handSignature(hand: { id: string }[]): string {
  return hand.map(c => c.id).sort().join(',');
}

describe('GameEngine — startingHands refresh on playAgain', () => {
  it('startingHands updates when a new game is dealt via playAgain', () => {
    const engine = new GameEngine('test-room', makePlayers());
    engine.startGame();

    // Snapshot the first deal's starting hands
    const firstHands = engine.getStartingHands();
    const firstSignatures: Record<string, string> = {};
    for (const [id, hand] of Object.entries(firstHands)) {
      firstSignatures[id] = handSignature(hand);
    }
    // Sanity: first deal populated all 6 players
    expect(Object.keys(firstHands)).toHaveLength(6);

    // Force the engine into a state where playAgain is acceptable.
    // Easiest: simulate game_over by setting the phase + finishOrder directly.
    const state = engine.getState();
    state.phase = 'game_over';
    state.finishOrder = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    for (const p of state.players) {
      p.isOut = true;
      p.finishOrder = state.finishOrder.indexOf(p.id) + 1;
    }

    // All 6 players ready triggers resetForNewGame internally, which re-deals
    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) {
      engine.playAgain(id);
    }

    // After re-deal, starting hands must be POPULATED (not empty) AND
    // different from the first deal (random new shuffle).
    const secondHands = engine.getStartingHands();
    expect(Object.keys(secondHands)).toHaveLength(6);

    // Each player's hand should still have 13 cards
    for (const [, hand] of Object.entries(secondHands)) {
      expect(hand.length).toBe(13);
    }

    // At least one player's hand signature must differ from the first deal
    // (random shuffle — it is overwhelmingly improbable that all 6 hands
    // come back identical, but we check at-least-one to keep the test stable).
    let anyDiffer = false;
    for (const id of Object.keys(secondHands)) {
      if (handSignature(secondHands[id]) !== firstSignatures[id]) {
        anyDiffer = true;
        break;
      }
    }
    expect(anyDiffer).toBe(true);
  });

  it('startingHands matches the dealt hands after playAgain (not stale from first game)', () => {
    const engine = new GameEngine('test-room', makePlayers());
    engine.startGame();

    const state = engine.getState();
    state.phase = 'game_over';
    state.finishOrder = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    for (const p of state.players) {
      p.isOut = true;
      p.finishOrder = state.finishOrder.indexOf(p.id) + 1;
    }

    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) {
      engine.playAgain(id);
    }

    // After re-deal: each player's CURRENT hand (state.players[i].hand) must
    // match their startingHands entry. Before the fix, startingHands was
    // stale from game 1 while state.players[i].hand was the new deal.
    const startingHands = engine.getStartingHands();
    const newState = engine.getState();
    for (const player of newState.players) {
      const startSig = handSignature(startingHands[player.id] ?? []);
      const currentSig = handSignature(player.hand);
      expect(startSig).toBe(currentSig);
    }
  });
});
