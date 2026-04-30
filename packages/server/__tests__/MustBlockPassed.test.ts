import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import { SmartRacerStrategy } from '../src/bot/BotManager.js';
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

describe('Fix C — must-block opponent has already passed this round', () => {
  it('Test 1: bot does NOT bomb a pair when the only must-block opponent has passed', () => {
    // Setup: p2 (seat 2, opponent) leads a K-pair. p4 (seat 4, opponent) has 1 card
    // and would normally trigger highThreat (opponentMinHand=1). BUT p4 has already
    // passed this cycle: lastPlay.playerId = p2 (seat 2), currentPlayerId = p0 (seat 0).
    // Clockwise walk from seat 3 to seat 5 (inclusive) passes through seat 4 — p4 passed.
    // Fix C: allDangerousOppsPassed=true → effectivelyHighThreat=false → P3 is skipped.
    // P5/medThreat fires: isBombPlay=true → hand>4 → pass.
    //
    // Pre-Fix-C this was a P3 bomb-play; the bot would burn a 5×3 bomb on a K-pair
    // even though p4 (the only 1-card threat) cannot play again this round.

    const kPair: Card[] = [
      card('K', 'hearts', true, 'p2-Kh'),
      card('K', 'spades', false, 'p2-Ks'),
    ];
    const p0Hand: Card[] = [
      card('5', 'hearts', true, 'p0-5h'),
      card('5', 'spades', false, 'p0-5s'),
      card('5', 'clubs', false, 'p0-5c'),
      card('3', 'clubs', false, 'p0-3c'),
      card('4', 'clubs', false, 'p0-4c'),
      card('6', 'clubs', false, 'p0-6c'),
      card('8', 'clubs', false, 'p0-8c'),
    ];

    const engine = new GameEngine('must-block-passed-test-1', makePlayers());
    engine.startGame();

    const state = engine.getState();

    // p0 is bot (red10 team), p2 and p4 are opponents (black10), others are teammates
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    // p1 — teammate
    state.players[1].hand = [card('3', 'spades', false, 'p1-3s'), card('4', 'spades', false, 'p1-4s'), card('7', 'spades', false, 'p1-7s')];
    state.players[1].handSize = 3;
    state.players[1].team = 'red10';

    // p2 — opponent who leads the K-pair; give them 6 cards total so after playing
    // the K-pair (2 cards) they have 4 remaining — handSize(4) > 3, which keeps
    // isLastPlayerDangerous=false and lets Fix C be the sole deciding factor.
    state.players[2].hand = [...kPair, card('6', 'spades', false, 'p2-6s'), card('8', 'spades', false, 'p2-8s'), card('9', 'spades', false, 'p2-9s'), card('J', 'spades', false, 'p2-Js')];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    // p3 — opponent with safe hand (will have passed in the cycle)
    state.players[3].hand = [card('3', 'diamonds', true, 'p3-3d'), card('4', 'diamonds', true, 'p3-4d'), card('9', 'diamonds', true, 'p3-9d')];
    state.players[3].handSize = 3;
    state.players[3].team = 'black10';

    // p4 — the must-block opponent at 1 card, seat 4 (PASSED in this cycle)
    state.players[4].hand = [card('J', 'diamonds', true, 'p4-Jd')];
    state.players[4].handSize = 1;
    state.players[4].team = 'black10';

    // p5 — opponent (will have passed in the cycle: seat 5 is between seats 2 and 0)
    state.players[5].hand = [card('3', 'clubs', false, 'p5-3c'), card('4', 'clubs', false, 'p5-4c'), card('9', 'clubs', false, 'p5-9c')];
    state.players[5].handSize = 3;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p2');

    // p2 plays the K-pair to set lastPlay
    const playResult = engine.playCards('p2', kPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);

    // Now override currentPlayerId to p0 (the bot), simulating that p3/p4/p5
    // have all passed between p2's play and p0's turn. This places p4 (seat 4)
    // in the clockwise range from seat 3 to seat 5 (between lastPlay=p2/seat2
    // and currentPlayer=p0/seat0) — so hasPassedThisRound returns true for p4.
    state.round!.currentPlayerId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    // Fix C: P3 must-block is skipped because the only ≤2-card opponent (p4)
    // has already passed. P5 medThreat: isBombPlay=true, handSize=7 > 4 → pass.
    expect(decision.action).toBe('pass');
  });

  it('Test 2: bot still bombs the pair when the must-block opponent has NOT passed', () => {
    // Same setup as Test 1 but now lastPlay is from p5 (seat 5). Clockwise walk
    // from seat 0 to seat 0 (currentPlayer=p0): the range (seat 0 up to but not
    // including seat 0) is empty — nobody has passed. p4 (seat 4) has NOT passed.
    // Fix C: allDangerousOppsPassed=false → effectivelyHighThreat=true → P3 fires.
    // Both P3 bomb guards pass (not single format, no 8-card opp) → bomb.

    const kPair: Card[] = [
      card('K', 'hearts', true, 'p5-Kh'),
      card('K', 'spades', false, 'p5-Ks'),
    ];
    const p0Hand: Card[] = [
      card('5', 'hearts', true, 'p0-5h'),
      card('5', 'spades', false, 'p0-5s'),
      card('5', 'clubs', false, 'p0-5c'),
      card('3', 'clubs', false, 'p0-3c'),
      card('4', 'clubs', false, 'p0-4c'),
      card('6', 'clubs', false, 'p0-6c'),
      card('8', 'clubs', false, 'p0-8c'),
    ];

    const engine = new GameEngine('must-block-passed-test-2', makePlayers());
    engine.startGame();

    const state = engine.getState();

    // p0 is bot (red10 team), p2/p4/p5 are opponents (black10), others are teammates
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    // p1 — teammate
    state.players[1].hand = [card('3', 'spades', false, 'p1-3s'), card('4', 'spades', false, 'p1-4s'), card('7', 'spades', false, 'p1-7s')];
    state.players[1].handSize = 3;
    state.players[1].team = 'red10';

    // p2 — teammate
    state.players[2].hand = [card('6', 'spades', false, 'p2-6s'), card('8', 'spades', false, 'p2-8s'), card('9', 'spades', false, 'p2-9s')];
    state.players[2].handSize = 3;
    state.players[2].team = 'red10';

    // p3 — opponent
    state.players[3].hand = [card('3', 'diamonds', true, 'p3-3d'), card('4', 'diamonds', true, 'p3-4d'), card('9', 'diamonds', true, 'p3-9d')];
    state.players[3].handSize = 3;
    state.players[3].team = 'black10';

    // p4 — must-block opponent at 1 card, seat 4 (has NOT passed — empty range)
    state.players[4].hand = [card('J', 'diamonds', true, 'p4-Jd')];
    state.players[4].handSize = 1;
    state.players[4].team = 'black10';

    // p5 — opponent who leads the K-pair
    state.players[5].hand = [...kPair, card('6', 'diamonds', true, 'p5-6d'), card('8', 'diamonds', true, 'p5-8d')];
    state.players[5].handSize = 4;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p5');

    // p5 plays the K-pair to set lastPlay
    const playResult = engine.playCards('p5', kPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);

    // Override currentPlayerId to p0. lastPlay.playerId = p5 (seat 5).
    // Clockwise walk from seat 0 up to (but not including) seat 0 is empty —
    // nobody is in the passed range. p4 (seat 4) has NOT passed this cycle.
    state.round!.currentPlayerId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    // Fix C: p4 has NOT passed → effectivelyHighThreat=true → P3 fires.
    // P3 bomb guards don't fire (format=pair, not single; no 8-card opponents).
    // Bot plays cheapest, which is the 5×3 bomb (the only play that beats a K-pair).
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(3);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });
});
