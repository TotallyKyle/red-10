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
    { id: 'p0', name: 'Alice', seatIndex: 0 },
    { id: 'p1', name: 'Bob', seatIndex: 1 },
    { id: 'p2', name: 'Charlie', seatIndex: 2 },
    { id: 'p3', name: 'Dave', seatIndex: 3 },
    { id: 'p4', name: 'Eve', seatIndex: 4 },
    { id: 'p5', name: 'Frank', seatIndex: 5 },
  ];
}

describe('Fix D — defensive mode for losing race', () => {
  it('does NOT bomb a pair when hand is weak and opp at 2 (defensive triggers)', () => {
    // p0 hand: 5×3 bomb + low singles, no winners outside the bomb (1 winner total).
    // Opp at 2 cards, my hand size 7 → defensive trigger fires.
    // Pre-Fix-D: would bomb the K-pair (P3 must-block, only the 5-bomb beats).
    // Post-Fix-D: defensive mode passes — burning a bomb to block when we can't
    // win the race is wasteful.

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

    const engine = new GameEngine('def-mode-test-1', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    // Multiple active opps (>3 cards each) so the aggressive override doesn't fire.
    state.players[1].hand = [card('3', 'spades', false, 'p1-3s'), card('4', 'spades', false, 'p1-4s'), card('7', 'spades', false, 'p1-7s'), card('9', 'spades', false, 'p1-9s'), card('Q', 'spades', false, 'p1-Qs')];
    state.players[1].handSize = 5;
    state.players[1].team = 'red10';

    state.players[2].hand = [...kPair, card('6', 'spades', false), card('8', 'spades', false), card('9', 'hearts', true), card('J', 'spades', false)];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true), card('9', 'diamonds', true), card('J', 'diamonds', true), card('A', 'diamonds', true)];
    state.players[3].handSize = 5;
    state.players[3].team = 'red10';

    // p4: opp at 2 cards — triggers defensive losing-race condition.
    state.players[4].hand = [card('J', 'hearts', true, 'p4-Jh'), card('Q', 'hearts', true, 'p4-Qh')];
    state.players[4].handSize = 2;
    state.players[4].team = 'black10';

    state.players[5].hand = [card('3', 'hearts', true, 'p5-3h'), card('4', 'hearts', true, 'p5-4h'), card('7', 'hearts', true, 'p5-7h'), card('A', 'spades', false, 'p5-As'), card('A', 'clubs', false, 'p5-Ac')];
    state.players[5].handSize = 5;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p2');
    const playResult = engine.playCards('p2', kPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);
    state.round!.currentPlayerId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    // Defensive: only beating play is the 5-bomb (a winner) → pass.
    expect(decision.action).toBe('pass');
  });

  it('legacy (defensive disabled) DOES bomb the pair on the same fixture', () => {
    // Same situation as above but with LegacyPreFixesStrategy (disableDefensiveMode=true).
    // Without defensive mode, the path falls into P3 effectivelyHighThreat (opp at 2)
    // and bombs to block.

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

    const engine = new GameEngine('def-mode-test-1-legacy', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    state.players[1].hand = [card('3', 'spades', false), card('4', 'spades', false), card('7', 'spades', false), card('9', 'spades', false), card('Q', 'spades', false)];
    state.players[1].handSize = 5;
    state.players[1].team = 'red10';

    state.players[2].hand = [...kPair, card('6', 'spades', false), card('8', 'spades', false), card('9', 'hearts', true), card('J', 'spades', false)];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true), card('9', 'diamonds', true), card('J', 'diamonds', true), card('A', 'diamonds', true)];
    state.players[3].handSize = 5;
    state.players[3].team = 'red10';

    state.players[4].hand = [card('J', 'hearts', true), card('Q', 'hearts', true)];
    state.players[4].handSize = 2;
    state.players[4].team = 'black10';

    state.players[5].hand = [card('3', 'hearts', true), card('4', 'hearts', true), card('7', 'hearts', true), card('A', 'spades', false), card('A', 'clubs', false)];
    state.players[5].handSize = 5;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p2');
    const playResult = engine.playCards('p2', kPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);
    state.round!.currentPlayerId = 'p0';

    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(3);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });

  it('aggressive override: only 1 active opponent → bombs as before (Fix D inert)', () => {
    // Most opponents are near-exit (≤3 cards). Only one opp has >3 cards, so
    // assessRaceMode flips to aggressive ("last_opponent"). P3 fires → bomb.
    //
    // Lead is from p5 (seat 5) so the clockwise walk to currentPlayer=p0 (seat 0)
    // is empty — nobody has pre-passed, allDangerousOppsPassed=false → P3 fires.

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

    const engine = new GameEngine('def-mode-test-2', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    // Teammates near-exit.
    state.players[1].hand = [card('3', 'spades', false), card('4', 'spades', false)];
    state.players[1].handSize = 2;
    state.players[1].team = 'red10';

    // Opp p2: dangerous (1 card) — triggers P3 must-block.
    state.players[2].hand = [card('J', 'hearts', true)];
    state.players[2].handSize = 1;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true)];
    state.players[3].handSize = 2;
    state.players[3].team = 'red10';

    // Opp p4: near-exit, not "active".
    state.players[4].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true)];
    state.players[4].handSize = 2;
    state.players[4].team = 'black10';

    // Opp p5: ONLY active opp (>3 cards). Leads K-pair. After play has 5 left.
    state.players[5].hand = [...kPair, card('6', 'spades', false), card('8', 'spades', false), card('9', 'hearts', true), card('J', 'spades', false), card('Q', 'spades', false)];
    state.players[5].handSize = 7;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p5');
    const playResult = engine.playCards('p5', kPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);
    state.round!.currentPlayerId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    // Aggressive override (only 1 active opp left, p5). P3 must-block fires
    // for p2 (1 card), allDangerousOppsPassed=false (empty walk range from
    // seat 5 to seat 0). Bot bombs the K-pair with the 5×3.
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(3);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });

  it('opportunistic: defensive bot plays cheap non-winner (5-pair) when available', () => {
    // p0 has 5-pair AND 5-bomb fragment + low singles. Last play is a 4-pair.
    // The cheapest beating play is 5-pair (not a winner — playMinRank=5, no bomb).
    // Defensive should fall through and play the 5-pair, not pass.

    const fourPair: Card[] = [
      card('4', 'hearts', true, 'p2-4h'),
      card('4', 'spades', false, 'p2-4s'),
    ];
    // p0: 5-pair as a regular pair (no triple to make it a bomb), low singles, no winners.
    // To avoid making 5s into a bomb (which IS a winner), only have 2 fives.
    const p0Hand: Card[] = [
      card('5', 'hearts', true, 'p0-5h'),
      card('5', 'spades', false, 'p0-5s'),
      card('3', 'clubs', false),
      card('6', 'clubs', false),
      card('7', 'clubs', false),
      card('8', 'clubs', false),
      card('9', 'clubs', false),
    ];

    const engine = new GameEngine('def-mode-test-3', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    state.players[1].hand = [card('3', 'spades', false), card('7', 'spades', false), card('9', 'spades', false), card('Q', 'spades', false), card('A', 'spades', false)];
    state.players[1].handSize = 5;
    state.players[1].team = 'red10';

    // p2 leads 4-pair. Has multiple cards left so isLastPlayerDangerous=false.
    state.players[2].hand = [...fourPair, card('6', 'spades', false), card('8', 'spades', false), card('9', 'hearts', true), card('J', 'spades', false)];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true), card('9', 'diamonds', true), card('J', 'diamonds', true), card('A', 'diamonds', true)];
    state.players[3].handSize = 5;
    state.players[3].team = 'red10';

    state.players[4].hand = [card('J', 'hearts', true, 'p4-Jh'), card('Q', 'hearts', true, 'p4-Qh')];
    state.players[4].handSize = 2; // triggers losing_race
    state.players[4].team = 'black10';

    state.players[5].hand = [card('3', 'hearts', true), card('7', 'hearts', true), card('A', 'clubs', false), card('K', 'spades', false), card('K', 'clubs', false)];
    state.players[5].handSize = 5;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p2');
    const playResult = engine.playCards('p2', fourPair);
    if (!playResult.success) throw new Error(`Setup play failed: ${playResult.error}`);
    state.round!.currentPlayerId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    // Cheapest beating play is 5-pair. playMinRank=5 (rv 2), not >= 11. Not a bomb.
    // Defensive does NOT trigger pass; falls through to existing logic which plays.
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(2);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });

  it('opening (P4): defensive bot leads low instead of high single when opp at 1', () => {
    // p0 leads. Opp at 1 card. Hand has only low cards, no pairs, no winners.
    // Pre-Fix-D: P4(c) leads HIGHEST single (Q) to prevent opp from beating a low lead.
    // Post-Fix-D: defensive mode skips P4(c); scoreOpening prefers a low orphan.

    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'hearts', true, 'p0-5h'),
      card('6', 'spades', false, 'p0-6s'),
      card('8', 'clubs', false, 'p0-8c'),
      card('9', 'spades', false, 'p0-9s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('Q', 'spades', false, 'p0-Qs'),
    ];

    const engine = new GameEngine('def-mode-test-4', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    // Multiple active opps to keep us in losing-race mode (not aggressive override).
    state.players[1].hand = [card('3', 'spades', false), card('5', 'spades', false), card('7', 'spades', false), card('A', 'spades', false), card('A', 'clubs', false)];
    state.players[1].handSize = 5;
    state.players[1].team = 'red10';

    state.players[2].hand = [card('K', 'hearts', true), card('K', 'spades', false), card('Q', 'hearts', true), card('Q', 'clubs', false), card('J', 'spades', false), card('9', 'hearts', true)];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true), card('9', 'diamonds', true), card('J', 'diamonds', true), card('A', 'diamonds', true)];
    state.players[3].handSize = 5;
    state.players[3].team = 'red10';

    // p4: opp at 1 card (triggers P4(c) pre-Fix-D AND defensive losing_race).
    state.players[4].hand = [card('J', 'hearts', true, 'p4-Jh')];
    state.players[4].handSize = 1;
    state.players[4].team = 'black10';

    state.players[5].hand = [card('3', 'clubs', false), card('4', 'hearts', true), card('7', 'hearts', true), card('K', 'clubs', false), card('A', 'hearts', true)];
    state.players[5].handSize = 5;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // Defensive skips P4(c) "highest single" rule. scoreOpening prefers low rank.
      // Should NOT lead Q (the highest single).
      expect(decision.cards.every(c => c.rank !== 'Q')).toBe(true);
      // And should be a single (no pairs/straights in this hand).
      expect(decision.cards.length).toBe(1);
    }
  });

  it('legacy on the same opening fixture leads HIGH single (Q) to block', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'hearts', true, 'p0-5h'),
      card('6', 'spades', false, 'p0-6s'),
      card('8', 'clubs', false, 'p0-8c'),
      card('9', 'spades', false, 'p0-9s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('Q', 'spades', false, 'p0-Qs'),
    ];

    const engine = new GameEngine('def-mode-test-4-legacy', makePlayers());
    engine.startGame();
    const state = engine.getState();

    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';

    state.players[1].hand = [card('3', 'spades', false), card('5', 'spades', false), card('7', 'spades', false), card('A', 'spades', false), card('A', 'clubs', false)];
    state.players[1].handSize = 5;
    state.players[1].team = 'red10';

    state.players[2].hand = [card('K', 'hearts', true), card('K', 'spades', false), card('Q', 'hearts', true), card('Q', 'clubs', false), card('J', 'spades', false), card('9', 'hearts', true)];
    state.players[2].handSize = 6;
    state.players[2].team = 'black10';

    state.players[3].hand = [card('3', 'diamonds', true), card('4', 'diamonds', true), card('9', 'diamonds', true), card('J', 'diamonds', true), card('A', 'diamonds', true)];
    state.players[3].handSize = 5;
    state.players[3].team = 'red10';

    state.players[4].hand = [card('J', 'hearts', true)];
    state.players[4].handSize = 1;
    state.players[4].team = 'black10';

    state.players[5].hand = [card('3', 'clubs', false), card('4', 'hearts', true), card('7', 'hearts', true), card('K', 'clubs', false), card('A', 'hearts', true)];
    state.players[5].handSize = 5;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');

    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // P4(c) "no multi-card available, lead HIGHEST single" → Q.
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('Q');
    }
  });
});
