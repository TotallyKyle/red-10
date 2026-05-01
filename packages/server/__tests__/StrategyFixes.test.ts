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

// ---- Fix 4 (83MQ): Conservative bomb-use carve-out for immediate threats ----

describe('Fix 4 — conservative bomb-use carve-out when opponentMinHand ≤ 2', () => {
  it('Test 8: 83MQ R6 — bombs A-pair when non-last opponent at 2 cards (highThreat-only path)', () => {
    // Faithful to 83MQ R6: last player (Eve) had 8 cards (NOT dangerous), but
    // a non-last opponent (Alice) was at 2 cards. This isolates the carve-out
    // to the highThreat path — isLastPlayerDangerous must be false so we know
    // the guard skip is driven by !highThreat alone.
    //
    // p0 (red10, opp, last player): leads A-pair from 10 cards → 8 left.
    //   handSize=8 → isLastPlayerDangerous=false (>3).
    // p2 (red10, opp, must-block target): 2 cards → opponentMinHand=2,
    //   highThreat=true.
    // p4 (red10, opp, large-hand): 8 cards — trips opponents.some(>=8).
    // p1 (us, black10): 7 cards: 3×3 bomb + 2-single + 3 fillers
    //   (winnerCount = 2: bomb + 2-single, so assessRaceMode stays aggressive).
    // p3, p5 (black10, teammates): both >2 cards (no teammate-rescue defensive).
    //
    // Without carve-out: opponents.some(>=8) true → guard fires → pass.
    // With carve-out: !highThreat=false → guard skipped → bombs.
    const aPair = [
      card('A', 'clubs', false, 'p0-Ac'),
      card('A', 'hearts', true, 'p0-Ah'),
    ];
    const p0Filler: Card[] = [
      card('K', 'spades', false, 'p0-Ks'),
      card('J', 'hearts', true, 'p0-Jh'),
      card('Q', 'hearts', true, 'p0-Qh'),
      card('9', 'spades', false, 'p0-9s'),
      card('8', 'hearts', true, 'p0-8h'),
      card('7', 'spades', false, 'p0-7s'),
      card('6', 'spades', false, 'p0-6s'),
      card('5', 'hearts', true, 'p0-5h'),
    ];
    const p1Hand: Card[] = [
      card('3', 'hearts', true, 'p1-3h'),
      card('3', 'spades', false, 'p1-3s'),
      card('3', 'diamonds', true, 'p1-3d'),
      card('2', 'hearts', true, 'p1-2h'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('8', 'clubs', false, 'p1-8c'),
    ];
    const p2Hand: Card[] = [
      card('4', 'spades', false, 'p2-4s'),
      card('5', 'spades', false, 'p2-5s'),
    ];
    const p3Hand: Card[] = [
      card('6', 'spades', false, 'p3-6s'),
      card('7', 'spades', false, 'p3-7s'),
      card('8', 'spades', false, 'p3-8s'),
      card('9', 'clubs', false, 'p3-9c'),
    ];
    const p4Hand: Card[] = [
      card('4', 'diamonds', true, 'p4-4d'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('6', 'diamonds', true, 'p4-6d'),
      card('7', 'diamonds', true, 'p4-7d'),
      card('8', 'diamonds', true, 'p4-8d'),
      card('9', 'diamonds', true, 'p4-9d'),
      card('J', 'diamonds', true, 'p4-Jd'),
      card('10', 'hearts', true, 'p4-10h'),
    ];
    const p5Hand: Card[] = [
      card('Q', 'spades', false, 'p5-Qs'),
      card('J', 'spades', false, 'p5-Js'),
      card('10', 'spades', false, 'p5-10s'),
      card('9', 'hearts', true, 'p5-9h'),
    ];
    const hands: Card[][] = [
      [...aPair, ...p0Filler],
      p1Hand,
      p2Hand,
      p3Hand,
      p4Hand,
      p5Hand,
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, aPair);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const usesThree = decision.cards.every(c => c.rank === '3');
      expect(usesThree).toBe(true);
      expect(decision.cards.length).toBe(3);
    }
  });

  it('Test 9: isLastPlayerDangerous-only with large-hand opp → guard fires (no carve-out)', () => {
    // p0 leads A-pair from 5 cards → 3 left after play. opponent counts:
    // p0=3, p2=5, p4=8. opponentMinHand=3 → highThreat=false.
    // isLastPlayerDangerous: p0 (opp), handSize=3 ≤ 3 → true.
    // Enters effectivelyHighThreat via isLastPlayerDangerous only.
    // Carve-out condition (!highThreat) is true → guard fires → bot passes.
    const aPair = [
      card('A', 'clubs', false, 'p0-Ac'),
      card('A', 'hearts', true, 'p0-Ah'),
    ];
    const p1Hand: Card[] = [
      card('3', 'hearts', true, 'p1-3h'),
      card('3', 'spades', false, 'p1-3s'),
      card('3', 'diamonds', true, 'p1-3d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('8', 'clubs', false, 'p1-8c'),
    ];
    const p4Hand: Card[] = [
      card('4', 'diamonds', true, 'p4-4d'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('6', 'diamonds', true, 'p4-6d'),
      card('7', 'diamonds', true, 'p4-7d'),
      card('8', 'diamonds', true, 'p4-8d'),
      card('9', 'diamonds', true, 'p4-9d'),
      card('J', 'diamonds', true, 'p4-Jd'),
      card('10', 'hearts', true, 'p4-10h'),
    ];
    // p1 needs winnerCount ≥ 2 and no teammate ≤ 2 to stay in aggressive mode.
    // Add 2♥ to p1 so 3-bomb + 2-single = 2 winners. Teammates p3, p5 both >2.
    const p1HandT9: Card[] = [
      card('3', 'hearts', true, 'p1-3h'),
      card('3', 'spades', false, 'p1-3s'),
      card('3', 'diamonds', true, 'p1-3d'),
      card('2', 'hearts', true, 'p1-2h'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('8', 'clubs', false, 'p1-8c'),
    ];
    const hands: Card[][] = [
      // p0 leads A-pair from 5 cards → 3 left
      [...aPair, card('2', 'clubs', false, 'p0-2c'), card('K', 'spades', false, 'p0-Ks'), card('J', 'hearts', true, 'p0-Jh')],
      p1HandT9,
      [card('4', 'spades', false, 'p2-4s'), card('5', 'spades', false, 'p2-5s'), card('6', 'spades', false, 'p2-6s'), card('7', 'spades', false, 'p2-7s'), card('8', 'spades', false, 'p2-8s')],
      [card('6', 'spades', false, 'p3-6s'), card('7', 'spades', false, 'p3-7s'), card('8', 'spades', false, 'p3-8s'), card('9', 'clubs', false, 'p3-9c')],
      p4Hand,
      [card('Q', 'spades', false, 'p5-Qs'), card('J', 'spades', false, 'p5-Js'), card('10', 'spades', false, 'p5-10s')],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, aPair);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });
});

// ---- Fix 5: isRed tiebreak — prefer non-red-10 plays at equal rank ----

describe('Fix 5 — isRed tiebreak (avoid gratuitous red-10 reveals)', () => {
  it('Test 10: Game 1 R3 — picks 10♠ over 10♥ when both beat 8♣ as singles', () => {
    // Reproduces Bot Dave's R3 mistake in 83MQ. Dave held both 10♥ and 10♠;
    // either single beats 8♣, but the bot picked 10♥ (revealing red10 team).
    // With the tiebreak: aMin+aRedTens for 10♠ = 7+0 = 7; for 10♥ = 7+1 = 8.
    // 10♠ wins.
    //
    // Setup: p0 (opp) leads 8♣ from 8 cards → 7 left. p1 (us, red10) holds
    // 10♥ + 10♠ + 5 fillers. Other opps have moderate hands so we're in
    // aggressive race posture (no teammate near exit, ≥2 winners not required
    // because no opp ≤ 2 → losing-race trigger doesn't fire).
    const eightClubs = card('8', 'clubs', false, 'p0-8c');
    const p0Filler: Card[] = [
      card('3', 'clubs', false, 'p0-3c'),
      card('4', 'spades', false, 'p0-4s'),
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'spades', false, 'p0-6s'),
      card('7', 'spades', false, 'p0-7s'),
      card('9', 'spades', false, 'p0-9s'),
      card('Q', 'clubs', false, 'p0-Qc'),
    ];
    const p1Hand: Card[] = [
      card('10', 'hearts', true, 'p1-10h'),
      card('10', 'spades', false, 'p1-10s'),
      card('J', 'hearts', true, 'p1-Jh'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('4', 'hearts', true, 'p1-4h'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
    ];
    const filler = (suitTag: string) => [
      card('3', 'spades', false, `${suitTag}-3s`),
      card('4', 'clubs', false, `${suitTag}-4c`),
      card('5', 'clubs', false, `${suitTag}-5c`),
      card('6', 'hearts', true, `${suitTag}-6h`),
      card('7', 'hearts', true, `${suitTag}-7h`),
      card('8', 'spades', false, `${suitTag}-8s`),
    ];
    // p1 (10♥) + p4 (10♦) hold the 2 red 10s → both are red10 team.
    const p4Hand: Card[] = [
      card('10', 'diamonds', true, 'p4-10d'),
      card('A', 'spades', false, 'p4-As'),
      card('A', 'diamonds', true, 'p4-Ad'),
      card('K', 'clubs', false, 'p4-Kc'),
      card('K', 'diamonds', true, 'p4-Kd'),
      card('9', 'hearts', true, 'p4-9h'),
      card('J', 'spades', false, 'p4-Js'),
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'black10', 'black10', 'red10', 'black10',
    ];
    const hands: Card[][] = [
      [eightClubs, ...p0Filler],
      p1Hand,
      filler('p2'),
      filler('p3'),
      p4Hand,
      filler('p5'),
    ];
    const engine = setupPlayingEngine(hands, teams, [eightClubs]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      const c = decision.cards[0];
      expect(c.rank).toBe('10');
      expect(c.isRed).toBe(false); // chose 10♠ not 10♥
    }
  });

  it('Test 11: Game 2 R4 — picks J♦Q♣K♥ over 10♥J♦Q♣ as 3-card straight', () => {
    // Reproduces Bot Eve's R4 mistake in DMQS. Eve had 10♥, J♦, Q♣, K♥ +
    // others; lead was 7♦ 8♠ 9♦ (3-card straight). Both 10-J-Q and J-Q-K
    // beat. Bot picked 10-J-Q because lower min rank — but it revealed 10♥.
    // With the tiebreak: 10-J-Q score = 7 (10) + 1 (red 10) = 8. J-Q-K = 8.
    // Tied → secondary tiebreak (fewer red tens) → J-Q-K wins.
    const lead = [
      card('7', 'diamonds', true, 'p0-7d'),
      card('8', 'spades', false, 'p0-8s'),
      card('9', 'diamonds', true, 'p0-9d'),
    ];
    const p0Filler: Card[] = [
      card('A', 'spades', false, 'p0-As'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'spades', false, 'p0-Ks'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('J', 'spades', false, 'p0-Js'),
      card('5', 'spades', false, 'p0-5s'),
    ];
    const p1Hand: Card[] = [
      card('10', 'hearts', true, 'p1-10h'),
      card('J', 'diamonds', true, 'p1-Jd'),
      card('Q', 'clubs', false, 'p1-Qc'),
      card('K', 'hearts', true, 'p1-Kh'),
      card('5', 'spades', false, 'p1-5s'),
      card('8', 'clubs', false, 'p1-8c'),
      card('2', 'spades', false, 'p1-2s'),
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'diamonds', true, 'p1-4d'),
    ];
    const filler = (suitTag: string) => [
      card('3', 'spades', false, `${suitTag}-3s`),
      card('5', 'clubs', false, `${suitTag}-5c`),
      card('6', 'hearts', true, `${suitTag}-6h`),
      card('7', 'hearts', true, `${suitTag}-7h`),
      card('9', 'spades', false, `${suitTag}-9s`),
    ];
    const p4Hand: Card[] = [
      card('10', 'diamonds', true, 'p4-10d'), // partner red 10 (so p1+p4 = red10)
      card('A', 'hearts', true, 'p4-Ah'),
      card('6', 'clubs', false, 'p4-6c'),
      card('K', 'diamonds', true, 'p4-Kd'),
      card('Q', 'diamonds', true, 'p4-Qd'),
      card('J', 'clubs', false, 'p4-Jc'),
    ];
    const hands: Card[][] = [
      [...lead, ...p0Filler],
      p1Hand,
      filler('p2'),
      filler('p3'),
      p4Hand,
      filler('p5'),
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'black10', 'black10', 'red10', 'black10',
    ];
    const engine = setupPlayingEngine(hands, teams, lead);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(3);
      const ranks = decision.cards.map(c => c.rank).sort();
      // J-Q-K straight — no rank '10'
      expect(ranks).toEqual(['J', 'K', 'Q']);
      const usesRedTen = decision.cards.some(c => c.rank === '10' && c.isRed);
      expect(usesRedTen).toBe(false);
    }
  });
});

// ---- Verification: bomb-preserving-straight filter on chooseBestOpening ----

/**
 * Build an engine with `leaderId` as the leader of a fresh round (no plays yet).
 * Used to test opening-only decisions without simulating a prior round.
 */
function setupOpeningEngine(
  hands: Card[][],
  teams: ('red10' | 'black10')[],
  leaderId: string,
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
  engine.startNewRound(leaderId);

  return engine;
}

describe('Verification — chooseBestOpening preserves 3-of-a-kind bombs', () => {
  it('Test 12: DMQS R9 hand — opens with single, never breaks 4-bomb with 3-4-5 straight', () => {
    // DMQS R9: Charlie held [4c, 4c, 4s, Qs, 9h, 5d, 3h] and opened with
    // 3♥ 4♣ 5♦ straight, breaking his 4-of-a-kind bomb. The bomb-preserving-
    // straight filter at chooseBestOpening (line ~328) should have excluded
    // 3-4-5 because rank '4' is in bombRanks. This test verifies the filter
    // behaves correctly on the exact hand. If it passes, the live game's
    // behavior was likely a stale deploy, not a code bug.
    const charlieHand: Card[] = [
      card('4', 'clubs', false, 'p1-4c1'),
      card('4', 'clubs', false, 'p1-4c2'),
      card('4', 'spades', false, 'p1-4s'),
      card('Q', 'spades', false, 'p1-Qs'),
      card('9', 'hearts', true, 'p1-9h'),
      card('5', 'diamonds', true, 'p1-5d'),
      card('3', 'hearts', true, 'p1-3h'),
    ];
    // Other players need 2 red 10s among them so the engine can identify a
    // red10 team. Charlie (p1) is on black10. Put red 10s with p0 and p4.
    const p0Hand: Card[] = [
      card('10', 'hearts', true, 'p0-10h'),
      card('A', 'spades', false, 'p0-As'),
      card('K', 'clubs', false, 'p0-Kc'),
      card('J', 'spades', false, 'p0-Js'),
      card('8', 'spades', false, 'p0-8s'),
      card('7', 'spades', false, 'p0-7s'),
      card('6', 'spades', false, 'p0-6s'),
    ];
    const p4Hand: Card[] = [
      card('10', 'diamonds', true, 'p4-10d'),
      card('A', 'hearts', true, 'p4-Ah'),
      card('K', 'diamonds', true, 'p4-Kd'),
      card('J', 'hearts', true, 'p4-Jh'),
      card('Q', 'hearts', true, 'p4-Qh'),
      card('9', 'diamonds', true, 'p4-9d'),
      card('8', 'hearts', true, 'p4-8h'),
    ];
    const blackFiller = (suitTag: string): Card[] => [
      card('2', 'spades', false, `${suitTag}-2s`),
      card('K', 'spades', false, `${suitTag}-Ks`),
      card('Q', 'clubs', false, `${suitTag}-Qc`),
      card('J', 'clubs', false, `${suitTag}-Jc`),
      card('9', 'clubs', false, `${suitTag}-9c`),
      card('8', 'clubs', false, `${suitTag}-8c`),
    ];
    const hands: Card[][] = [
      p0Hand,
      charlieHand,
      blackFiller('p2'),
      blackFiller('p3'),
      p4Hand,
      blackFiller('p5'),
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'black10', 'black10', 'red10', 'black10',
    ];
    const engine = setupOpeningEngine(hands, teams, 'p1');

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // The bot must NOT play a multi-card play that includes any rank-4 card,
      // since rank 4 is bomb-rank in this hand. Acceptable plays: any single
      // (3, 5, 9, Q) or… actually no other multi-card plays exist without
      // rank 4 from this hand (no pairs, no straight without 4).
      const usesRankFour = decision.cards.some(c => c.rank === '4');
      expect(usesRankFour).toBe(false);
      expect(decision.cards.length).toBe(1); // forced to a single
    }
  });
});
