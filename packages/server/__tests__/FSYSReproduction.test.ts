import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import { SmartRacerStrategy } from '../src/bot/BotManager.js';
import type { Card } from '@red10/shared';

function card(rank: string, suit: string, isRed: boolean, id: string): Card {
  return { id, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
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

describe('FSYS bomb-rank filter — chooseBestOpening must not break a 5×3 bomb', () => {
  it('Alice opens with hand 5D,5C,5S,6C,7H,2H — must NOT play a straight using rank 5', () => {
    // Reproduction of the FSYS game review: at start of R11, Alice had 6 cards
    // including 3 fives (a 5×3 bomb). The bot opened with 5♦6♣7♥ straight,
    // breaking the bomb. The filter in chooseBestOpening should have excluded
    // any straight containing a card with rank '5' (the bomb rank).

    const aliceHand: Card[] = [
      card('5', 'diamonds', true, 'a-5d'),
      card('5', 'clubs', false, 'a-5c'),
      card('5', 'spades', false, 'a-5s'),
      card('6', 'clubs', false, 'a-6c'),
      card('7', 'hearts', true, 'a-7h'),
      card('2', 'hearts', true, 'a-2h'),
    ];
    const dummyHand: Card[] = [
      card('3', 'spades', false, 'x-3s'),
      card('4', 'spades', false, 'x-4s'),
      card('8', 'spades', false, 'x-8s'),
      card('9', 'spades', false, 'x-9s'),
      card('10', 'spades', false, 'x-10s'),
      card('J', 'spades', false, 'x-Js'),
    ];

    const engine = new GameEngine('fsys-test', makePlayers());
    engine.startGame();

    const state = engine.getState();
    state.players[0].hand = aliceHand;
    state.players[0].handSize = 6;
    state.players[0].team = 'black10';
    for (let i = 1; i < 6; i++) {
      state.players[i].hand = [...dummyHand];
      state.players[i].handSize = dummyHand.length;
      state.players[i].team = i <= 2 ? 'black10' : 'red10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');

    // Alice is leading; ask the bot what to play
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      console.log('decision.cards =', decision.cards.map(c => `${c.rank}${c.suit[0]}`).join(','));
      // Hard requirement: no card with rank '5' should appear in Alice's opening
      // play. Alice has a 5×3 bomb that must be preserved.
      const usesFive = decision.cards.some(c => c.rank === '5');
      expect(usesFive).toBe(false);
    }
  });
});
