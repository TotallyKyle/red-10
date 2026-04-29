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

/**
 * Build an engine in doubling phase with custom hands assigned to each player.
 * Teams are derived from red 10 ownership so the engine team assignment mirrors
 * what createEngineWithHands does in Doubling.test.ts.
 */
function setupDoublingEngine(hands: Card[][]): GameEngine {
  const engine = new GameEngine('strategy-fixes-test', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    const hasRed10 = hands[i].some(c => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
    state.players[i].revealedRed10Count = 0;
  }

  return engine;
}

/**
 * Build an engine in playing phase with p0 having already led a play, so p1
 * is next to act. `hands[0]` is the full hand p0 has before leading; p0 plays
 * `leaderPlay` (a subset of hands[0]) so they retain the remaining cards.
 * Callers must ensure leaderPlay cards appear in hands[0] with matching IDs.
 */
function setupPlayingEngine(
  hands: Card[][],
  teams: ('red10' | 'black10')[],
  leaderPlay: Card[],
): GameEngine {
  const engine = new GameEngine('strategy-fixes-test', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    state.players[i].team = teams[i];
  }
  state.phase = 'playing';
  state.doubling = null;
  // p0 leads the round — hand is already set above (full hand including leaderPlay cards)
  engine.startNewRound('p0');

  // Play the leader cards: the engine will remove them from p0's hand
  const result = engine.playCards('p0', leaderPlay);
  if (!result.success) throw new Error(`Setup play failed: ${result.error}`);

  return engine;
}

// ---- Fix 2: 2v4 doubling penalty ----

describe('Fix 2 — 2v4 doubling penalty', () => {
  it('Test 1: 2 red 10s + 1 bomb rank (7×4) at borderline strength → skip', () => {
    // Hand: 2 red 10s + 7×4 + one filler.
    // evaluateHandStrength: bomb(+3) + fourPlusBomb(+2) + density≤4(+4) = 9
    // Normal threshold = 9: strength(9) >= threshold(9) AND hasStrongStructure
    //   (distinctBombRanks=1, groups.size=3≤4) → would double without fix.
    // 2v4 penalty: effectiveThreshold=11, hasStrongStructure requires distinctBombRanks≥2
    //   → both conditions fail → skip.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('10', 'diamonds', true, 'p0-10d'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
    ];
    const filler: Card[] = [
      card('5', 'clubs', false),
      card('6', 'clubs', false),
      card('8', 'clubs', false),
      card('9', 'clubs', false),
      card('J', 'clubs', false),
    ];
    const hands: Card[][] = [p0Hand, filler, filler, filler, filler, filler];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('skip');
  });

  it('Test 2: 2 red 10s + 2 bomb ranks (7×3 + Q×3) → double', () => {
    // Hand: 2 red 10s + 7×3 + Q×3 + 1 filler.
    // evaluateHandStrength: bomb(+3) + secondBomb(+4) + density=4≤4(+4) = 11
    // 2v4 penalty: effectiveThreshold=11, hasStrongStructure requires distinctBombRanks≥2 (=2) → true
    // strength(11) >= effectiveThreshold(11) AND hasStrongStructure → double.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('10', 'diamonds', true, 'p0-10d'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('Q', 'hearts', true, 'p0-Qh'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('Q', 'clubs', false, 'p0-Qc'),
      card('3', 'clubs', false, 'p0-3c'),
    ];
    const filler: Card[] = [
      card('5', 'clubs', false),
      card('6', 'clubs', false),
      card('8', 'clubs', false),
      card('9', 'clubs', false),
      card('J', 'clubs', false),
    ];
    const hands: Card[][] = [p0Hand, filler, filler, filler, filler, filler];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });

  it('Test 3: 1 red 10 + 7×4 at strength 9 → double (no 2v4 penalty)', () => {
    // Same structural strength as Test 1 but only 1 red 10 — isKnown2v4=false.
    // Normal: strength(9) >= threshold(9), hasStrongStructure (1 bomb + groups≤4) → double.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
    ];
    // Other players must hold the other red 10s so p0 is identified as red10 team.
    const filler: Card[] = [
      card('5', 'clubs', false),
      card('6', 'clubs', false),
      card('8', 'clubs', false),
      card('9', 'clubs', false),
      card('J', 'clubs', false),
    ];
    const hands: Card[][] = [p0Hand, filler, filler, filler, filler, filler];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });

  it('Test 4: Black10 player + 7×4 at strength 9 → double (no 2v4 penalty)', () => {
    // Black10 player with 0 red 10s. Same bomb structure.
    // isKnown2v4=false, normal behavior: strength(9) >= threshold(9), hasStrongStructure → double.
    const p0Hand: Card[] = [
      card('7', 'hearts', true, 'p0-7h'),
      card('7', 'spades', false, 'p0-7s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('7', 'diamonds', true, 'p0-7d'),
      card('3', 'clubs', false, 'p0-3c'),
      card('4', 'clubs', false, 'p0-4c'),
    ];
    // Give p1 a red 10 so at least one team is red10 (engine validity).
    const fillerWithRed10: Card[] = [
      card('10', 'hearts', true),
      card('5', 'clubs', false),
      card('6', 'clubs', false),
      card('8', 'clubs', false),
      card('J', 'clubs', false),
    ];
    const filler: Card[] = [
      card('5', 'spades', false),
      card('6', 'spades', false),
      card('8', 'spades', false),
      card('9', 'spades', false),
      card('J', 'spades', false),
    ];
    const hands: Card[][] = [p0Hand, fillerWithRed10, filler, filler, filler, filler];
    const engine = setupDoublingEngine(hands);

    const decision = SmartRacerStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });
});

// ---- Fix 3: Don't bomb singles in P3 unless near-exit / must-block ----

describe('Fix 3 — no bombing singles in P3 unless exit/must-block', () => {
  it('Test 5: bomb available, opponent leads single Q, opponent has 3 cards → pass', () => {
    // p0 (opponent, black10) leads single Q with 3 cards. After playing, p0 has 2 cards
    // remaining → opponentMinHand=2, highThreat=true, isLastPlayerDangerous=true.
    // p1 (red10) has 6 cards: a 9×3 bomb + 3 fillers. handSize(6) - bomb.length(3) = 3 > 2,
    // so the near-exit shortcut doesn't fire.
    // Fix 3: isBombPlay && format=single && !tryingToExit && opponentMinHand>1 → pass.
    const qCard = card('Q', 'hearts', true, 'p0-Qh');
    const p1Hand: Card[] = [
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'spades', false, 'p1-9s'),
      card('9', 'clubs', false, 'p1-9c'),
      card('3', 'clubs', false, 'p1-3c'),
      card('4', 'clubs', false, 'p1-4c'),
      card('5', 'clubs', false, 'p1-5c'),
    ];
    const hands: Card[][] = [
      // p0 leads — will play single Q (given 3 cards total → 2 remain after play)
      [qCard, card('5', 'hearts', true, 'p0-5h'), card('6', 'clubs', false, 'p0-6c')],
      p1Hand,
      [card('3', 'spades', false), card('4', 'spades', false), card('5', 'spades', false)],
      [card('6', 'spades', false), card('7', 'spades', false), card('8', 'spades', false)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, [qCard]);

    // p1 responds: has a 9×3 bomb that can beat single Q (bombs beat everything).
    // Fix 3 should make p1 pass instead of bomb.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  it('Test 6: bomb available, opponent leads single Q, opponent has 1 card left → bomb (must-block)', () => {
    // p0 leads single Q from 2 cards → after playing Q, p0 has 1 card remaining.
    // opponentMinHand = 1 ≤ 1 → must-block carve-out: Fix 3 guard does NOT fire.
    // highThreat = opponentMinHand(1) ≤ 2 = true → P3 block fires.
    // p1 has 6 cards: 9×3 bomb + 3 fillers. handSize(6) - bomb(3) = 3 > 2 → no near-exit.
    // No other P3 guard fires → bot bombs.
    const qCard = card('Q', 'hearts', true, 'p0-Qh');
    const p1Hand: Card[] = [
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'spades', false, 'p1-9s'),
      card('9', 'clubs', false, 'p1-9c'),
      card('3', 'clubs', false, 'p1-3c'),
      card('4', 'clubs', false, 'p1-4c'),
      card('5', 'clubs', false, 'p1-5c'),
    ];
    const hands: Card[][] = [
      // p0 leads from 2 cards → 1 remains after playing Q
      [qCard, card('6', 'clubs', false, 'p0-6c')],
      p1Hand,
      [card('3', 'spades', false), card('4', 'spades', false), card('5', 'spades', false)],
      [card('6', 'spades', false), card('7', 'spades', false), card('8', 'spades', false)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, [qCard]);

    // opponentMinHand = 1 ≤ 1 → must-block carve-out → bomb is allowed.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const usesNine = decision.cards.some(c => c.rank === '9');
      expect(usesNine).toBe(true);
    }
  });

  it('Test 7: bomb available, opponent leads pair Q×2, opponent has 3 cards → bombs (not single format)', () => {
    // The Fix 3 guard only fires for format='single'. A pair lead is unaffected.
    // p0 leads Q×2 from 4 cards → after play, p0 has 2 cards remaining.
    // opponentMinHand=2 → highThreat=true, P3 fires.
    // Fix 3 guard: format is 'pair', not 'single' → does not fire.
    // Existing 8-card guard: no opponents have ≥8 cards → does not fire.
    // p1 has 6 cards: 9×3 bomb + 3 fillers. handSize(6) - bomb(3) = 3 > 2 → no near-exit.
    // Bot bombs the pair lead.
    const qPair = [
      card('Q', 'hearts', true, 'p0-Qh'),
      card('Q', 'spades', false, 'p0-Qs'),
    ];
    const p1Hand: Card[] = [
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'spades', false, 'p1-9s'),
      card('9', 'clubs', false, 'p1-9c'),
      card('3', 'clubs', false, 'p1-3c'),
      card('4', 'clubs', false, 'p1-4c'),
      card('5', 'clubs', false, 'p1-5c'),
    ];
    const hands: Card[][] = [
      // p0 leads with Q pair (4 cards total → 2 remain after play)
      [...qPair, card('5', 'hearts', true, 'p0-5h'), card('6', 'clubs', false, 'p0-6c')],
      p1Hand,
      [card('3', 'spades', false), card('4', 'spades', false), card('5', 'spades', false)],
      [card('6', 'spades', false), card('7', 'spades', false), card('8', 'spades', false)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('5', 'diamonds', true)],
      [card('6', 'diamonds', true), card('7', 'diamonds', true), card('8', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, qPair);

    // pair lead — Fix 3 single-only guard does not apply. Bot should bomb.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const usesNine = decision.cards.some(c => c.rank === '9');
      expect(usesNine).toBe(true);
    }
  });
});
