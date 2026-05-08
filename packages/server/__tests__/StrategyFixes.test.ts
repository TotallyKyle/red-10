import { describe, it, expect, afterEach } from 'vitest';
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

// ---- Fix M3: 3-of-a-kind cha on teammate trigger at large hand size ----

describe('Fix M3 — paired-cha with 3-of-a-kind on teammate trigger when stuck big-hand', () => {
  // estimatePlayedCopies has a 40% chance of ±1 miscount. Pin Math.random to
  // make the count exact so we can deterministically assert the carve-out.
  const realRandom = Math.random;
  afterEach(() => { Math.random = realRandom; });

  it('cha with 3-of-rank on teammate trigger when handSize ≥ 10 and ≤2 copies remain', () => {
    Math.random = () => 0.99; // > 0.4 → no miscount in estimatePlayedCopies

    // Scenario from game 1 LA76 R1 / SFYD R3: bot holds 3 copies of trigger
    // rank, big hand, teammate triggers. Pre-fix: bomb-preservation gate
    // returned decline. Post-fix: at handSize ≥ 10 with ≤ 2 copies remaining
    // anywhere else, the auto-win path is worth the bomb-rank loss.
    //
    // Setup: p0 (red10, teammate) leads 3♦ single. Bot p1 (red10) holds three
    // 3s (3♣, 3♥, 3♠ — black 3s + red 3♥) plus 8 other non-3 cards.
    // Total 3s in 1.5 decks = 6. Played: 1. In bot's hand: 3. Remaining = 2.

    const p0Hand: Card[] = [
      card('3', 'diamonds', true, 'p0-3d'), // trigger
      card('5', 'clubs', false, 'p0-5c'),
      card('7', 'hearts', true, 'p0-7h'),
      card('10', 'hearts', true, 'p0-10h'), // p0 holds a red 10 → red10 team
    ];

    // p1: bot, 11 cards (3 threes + 8 unrelated)
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c1'),
      card('3', 'clubs', false, 'p1-3c2'),
      card('3', 'spades', false, 'p1-3s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('8', 'diamonds', true, 'p1-8d'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
      card('K', 'spades', false, 'p1-Ks'),
      card('Q', 'diamonds', true, 'p1-Qd'),
      card('10', 'diamonds', true, 'p1-10d'), // p1 holds a red 10 → red10 team
    ];

    // p2-p5: filler. Distribute the remaining 2 threes among them so the count
    // is consistent (otherwise the engine has cards that don't exist in 1.5
    // decks, but estimatePlayedCopies only counts what it sees, not the deck
    // total). Use 2 threes among p2-p3 + harmless filler elsewhere.
    const p2Hand: Card[] = [
      card('3', 'hearts', true, 'p2-3h-extra'), // 1 of 2 remaining 3s
      card('4', 'clubs', false, 'p2-4c'),
      card('6', 'clubs', false, 'p2-6c'),
      card('7', 'clubs', false, 'p2-7c'),
    ];
    const p3Hand: Card[] = [
      card('3', 'diamonds', true, 'p3-3d-extra'), // 2nd of 2 remaining 3s
      card('4', 'spades', false, 'p3-4s'),
      card('6', 'hearts', true, 'p3-6h'),
      card('8', 'spades', false, 'p3-8s'),
    ];
    const filler = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('7', 'spades', false, `${tag}-7s`),
      card('K', 'clubs', false, `${tag}-Kc`),
    ];

    const engine = new GameEngine('m3-test', makePlayers());
    engine.startGame();

    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'black10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = filler('p4');
    state.players[4].handSize = 4;
    state.players[4].team = 'black10';
    state.players[5].hand = filler('p5');
    state.players[5].handSize = 4;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');

    // p0 leads 3♦ single → engine creates waiting_cha state with p1 eligible
    const playResult = engine.playCards('p0', [p0Hand[0]]);
    expect(playResult.success).toBe(true);

    const roundState = engine.getState().round;
    expect(roundState?.chaGoState?.phase).toBe('waiting_cha');
    expect(roundState?.chaGoState?.eligiblePlayerIds).toContain('p1');
    expect(roundState?.chaGoState?.triggerRank).toBe('3');

    // afterChaRemaining = 6 - (1 played + 3 in p1 hand) = 2.
    // Pre-fix: bomb-preservation gate (`matchingCards.length=3 && 3-2 < 3`)
    //   returned decline. Even with the gate bypassed, the LOW-rank +
    //   teammate-trigger path falls through to a final `return 'decline'`.
    // Post-fix: stuckBigHandTeammateCha (handSize=11, triggerIsTeammate,
    //   estimatedRemaining=2) actively returns 'cha' BEFORE both gates.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('cha');
    if (decision.action === 'cha') {
      expect(decision.cards).toHaveLength(2);
      expect(decision.cards.every(c => c.rank === '3')).toBe(true);
    }
  });

  it('declines cha at handSize 9 (below big-hand threshold) — carve-out does not fire', () => {
    Math.random = () => 0.99;
    // Same scenario as above but bot's hand is 9 cards (3 threes + 6 others).
    // handSize 9 < 10 → carve-out does not fire → bomb-preservation gate
    // returns decline.
    const p0Hand: Card[] = [
      card('3', 'diamonds', true, 'p0-3d'),
      card('5', 'clubs', false, 'p0-5c'),
      card('7', 'hearts', true, 'p0-7h'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c1'),
      card('3', 'clubs', false, 'p1-3c2'),
      card('3', 'spades', false, 'p1-3s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('8', 'diamonds', true, 'p1-8d'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
      card('10', 'diamonds', true, 'p1-10d'),
    ];
    const filler = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('K', 'clubs', false, `${tag}-Kc`),
      card('4', 'spades', false, `${tag}-4s`),
    ];

    const engine = new GameEngine('m3-test-9', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    for (let i = 2; i <= 5; i++) {
      state.players[i].hand = filler(`p${i}`);
      state.players[i].handSize = 4;
      state.players[i].team = 'black10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('decline_cha');
  });

  it('declines cha when miscount inflates estimatedRemaining to 3 (carve-out gate fires correctly)', () => {
    // Force estimatePlayedCopies into the -1 miscount branch. With 3-in-hand
    // + 1 played = 4 known, miscount=-1 yields totalKnown=3 → remaining=3
    // → carve-out condition (remaining ≤ 2) fails → bomb-preservation gate
    // declines.
    //
    // estimatePlayedCopies makes 2 Math.random calls when entering the miscount
    // branch: 1st must be < 0.4 (enter), 2nd must be ≥ 0.5 (-1 branch).
    let n = 0;
    Math.random = () => {
      n++;
      return n === 1 ? 0.3 : 0.6;
    };

    const p0Hand: Card[] = [
      card('3', 'diamonds', true, 'p0-3d'),
      card('5', 'clubs', false, 'p0-5c'),
      card('7', 'hearts', true, 'p0-7h'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c1'),
      card('3', 'clubs', false, 'p1-3c2'),
      card('3', 'spades', false, 'p1-3s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('8', 'diamonds', true, 'p1-8d'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
      card('K', 'spades', false, 'p1-Ks'),
      card('Q', 'diamonds', true, 'p1-Qd'),
      card('10', 'diamonds', true, 'p1-10d'),
    ];
    const filler = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('K', 'clubs', false, `${tag}-Kc`),
      card('4', 'spades', false, `${tag}-4s`),
    ];

    const engine = new GameEngine('m3-test-miscount', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    for (let i = 2; i <= 5; i++) {
      state.players[i].hand = filler(`p${i}`);
      state.players[i].handSize = 4;
      state.players[i].team = 'black10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    // Miscount path makes estimatedRemaining = 3 → carve-out fails →
    // bomb-preservation gate declines. (After the miscount-aware decision
    // path is exercised, n=2; subsequent Math.random calls in this turn
    // return 0.6 which is ≥ 0.5 — fine for downstream paths.)
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('decline_cha');
  });

  it('declines cha for HIGH-rank (A) teammate trigger even at handSize ≥ 10 — preserves A-bomb', () => {
    Math.random = () => 0.99;
    // Same big-hand setup but trigger rank is A (HIGH). Carve-out is gated on
    // !isHighRank to avoid breaking valuable high-rank bombs. Bot still has
    // 3-of-As, but the HIGH-rank cutoff returns decline.
    const p0Hand: Card[] = [
      card('A', 'diamonds', true, 'p0-Ad'),  // trigger
      card('5', 'clubs', false, 'p0-5c'),
      card('7', 'hearts', true, 'p0-7h'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    const p1Hand: Card[] = [
      card('A', 'clubs', false, 'p1-Ac1'),
      card('A', 'clubs', false, 'p1-Ac2'),
      card('A', 'spades', false, 'p1-As'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('8', 'diamonds', true, 'p1-8d'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
      card('K', 'spades', false, 'p1-Ks'),
      card('Q', 'diamonds', true, 'p1-Qd'),
      card('10', 'diamonds', true, 'p1-10d'),
    ];
    const filler = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('K', 'clubs', false, `${tag}-Kc`),
      card('4', 'spades', false, `${tag}-4s`),
    ];

    const engine = new GameEngine('m3-test-high', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    for (let i = 2; i <= 5; i++) {
      state.players[i].hand = filler(`p${i}`);
      state.players[i].handSize = 4;
      state.players[i].team = 'black10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('decline_cha');
  });
});

// ---- Fix M4: race-aware bomb cap when isLastPlayerDangerous is sole trigger ----

describe('Fix M4 — bomb cap at handSize > 8 when only isLastPlayerDangerous unlocks bombs', () => {
  it('passes on bomb response when handSize=12, opp_min=3, no opp ≤ 2', () => {
    // p0 (opp) leads K-pair, ending at handSize 3 (isLastPlayerDangerous=true).
    // p1 (bot) at handSize 12 has only a 9-bomb to beat the K-pair.
    // No opp at ≤ 2 (so highThreat=false). No opp at ≥ 8 (so the conservative-
    // 3-bomb guard doesn't fire). Pre-fix: M4 guard absent → bot bombs.
    // Post-fix: M4 guard fires → bot passes.

    // p0 starts with 5 cards including K-pair. After K-pair play → handSize 3.
    const p0Hand: Card[] = [
      card('K', 'spades', false, 'p0-Ks'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('9', 'spades', false, 'p0-9s'),
    ];
    // p1 (bot, red10) at handSize 12 with 9-bomb (3 nines, length 3 bomb).
    const p1Hand: Card[] = [
      card('9', 'clubs', false, 'p1-9c1'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'diamonds', true, 'p1-9d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'clubs', false, 'p1-4c'),
      card('3', 'hearts', true, 'p1-3h'),
      card('3', 'diamonds', true, 'p1-3d'),
      card('J', 'spades', false, 'p1-Js'),
      card('10', 'hearts', true, 'p1-10h'), // red 10
    ];
    // Other opps: all > 2 cards, all < 8 cards (so no triple-bomb guard).
    const filler4 = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'spades', false, `${tag}-6s`),
      card('7', 'spades', false, `${tag}-7s`),
      card('8', 'spades', false, `${tag}-8s`),
    ];

    const engine = new GameEngine('m4-test-pass', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'black10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    for (let i = 2; i <= 5; i++) {
      state.players[i].hand = filler4(`p${i}`);
      state.players[i].handSize = 4;
      // mix teams; doesn't matter for this test as long as p0 stays opp to p1
      state.players[i].team = i % 2 === 0 ? 'black10' : 'red10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    // p0 plays K-pair → handSize 3
    const playResult = engine.playCards('p0', [p0Hand[0], p0Hand[1]]);
    expect(playResult.success).toBe(true);
    expect(state.players[0].handSize).toBe(3);

    // Now currentPlayerId should be p1 (bot's turn to respond)
    expect(engine.getState().round?.currentPlayerId).toBe('p1');

    // Bot's only beat to K-pair is 9-bomb. With M4: should pass at handSize 12.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  it('plays bomb at handSize 8 (at threshold) — M4 cap is myHandSize > 8, not ≥ 8', () => {
    // Same setup but bot at handSize 8. M4 guard requires handSize > 8, so
    // at exactly 8 the guard does NOT fire → bomb plays.
    const p0Hand: Card[] = [
      card('K', 'spades', false, 'p0-Ks'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('9', 'spades', false, 'p0-9s'),
    ];
    const p1Hand: Card[] = [
      card('9', 'clubs', false, 'p1-9c1'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'diamonds', true, 'p1-9d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('J', 'spades', false, 'p1-Js'),
      card('10', 'hearts', true, 'p1-10h'),
    ];
    const filler4 = (tag: string): Card[] => [
      card('5', 'spades', false, `${tag}-5s`),
      card('6', 'spades', false, `${tag}-6s`),
      card('7', 'spades', false, `${tag}-7s`),
      card('8', 'spades', false, `${tag}-8s`),
    ];

    const engine = new GameEngine('m4-test-h8', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'black10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    for (let i = 2; i <= 5; i++) {
      state.players[i].hand = filler4(`p${i}`);
      state.players[i].handSize = 4;
      state.players[i].team = i % 2 === 0 ? 'black10' : 'red10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0], p0Hand[1]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.every(c => c.rank === '9')).toBe(true);
    }
  });

  it('still bombs at handSize 12 when highThreat (opp at ≤ 2) — M4 only fires when !highThreat', () => {
    // Same setup as the first M4 test, but one of the other opps is at
    // handSize 2 (highThreat=true). M4 guard requires !highThreat → does not
    // fire. The conservative-3-bomb guard also has a !highThreat condition
    // → does not fire. Bot bombs.
    const p0Hand: Card[] = [
      card('K', 'spades', false, 'p0-Ks'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('9', 'spades', false, 'p0-9s'),
    ];
    const p1Hand: Card[] = [
      card('9', 'clubs', false, 'p1-9c1'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'diamonds', true, 'p1-9d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'clubs', false, 'p1-4c'),
      card('3', 'hearts', true, 'p1-3h'),
      card('3', 'diamonds', true, 'p1-3d'),
      card('J', 'spades', false, 'p1-Js'),
      card('10', 'hearts', true, 'p1-10h'),
    ];

    const engine = new GameEngine('m4-test-high-threat', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'black10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    // p2 = OPP (black10) at handSize 2 → triggers highThreat
    state.players[2].hand = [
      card('5', 'spades', false, 'p2-5s'),
      card('6', 'spades', false, 'p2-6s'),
    ];
    state.players[2].handSize = 2;
    state.players[2].team = 'black10';
    // p3-p5: filler, opp/teammate mix, all > 2 cards, < 8
    for (let i = 3; i <= 5; i++) {
      state.players[i].hand = [
        card('5', 'spades', false, `p${i}-5s`),
        card('6', 'spades', false, `p${i}-6s`),
        card('7', 'spades', false, `p${i}-7s`),
        card('8', 'spades', false, `p${i}-8s`),
      ];
      state.players[i].handSize = 4;
      state.players[i].team = i % 2 === 0 ? 'black10' : 'red10';
    }
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0], p0Hand[1]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.every(c => c.rank === '9')).toBe(true);
    }
  });
});

// ---- Fix M5: extend conservative bomb-use guard to bomb-vs-bomb ----

describe('Fix M5 — bomb-vs-bomb sandwich avoidance when opp ≥ 8 still active', () => {
  it('passes on 3-bomb response to opp 3-bomb in P6 conservation when opp ≥ 8 active', () => {
    // 8NW6 R3 reproduction: opp Charlie plays 8×3 bomb; bot Alice has 9×3.
    // Per pre-M5 behavior in P6 conservation, Alice would bomb (9-bomb beats
    // 8-bomb). With M5, since another opp Eve is at handSize ≥ 8 (likely
    // holds a bigger bomb), Alice passes.
    //
    // Setup: p0 (opp) leads 8×3 normal bomb. p1 (bot) at handSize 13 has 9×3.
    // p4 (another opp) at handSize 13. opp_min = 8 (the lead player), no opp
    // ≤ 3 → !effectivelyHighThreat → P6 conservation block.
    const p0Hand: Card[] = [
      card('8', 'clubs', false, 'p0-8c1'),
      card('8', 'clubs', false, 'p0-8c2'),
      card('8', 'spades', false, 'p0-8s'),
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'spades', false, 'p0-6s'),
      card('7', 'spades', false, 'p0-7s'),
      card('A', 'clubs', false, 'p0-Ac'),
    ];
    // p1 (bot, red10) at handSize 13 with 9×3 + 10 mid-rank fillers
    const p1Hand: Card[] = [
      card('9', 'clubs', false, 'p1-9c1'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'diamonds', true, 'p1-9d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'spades', false, 'p1-4s'),
      card('J', 'clubs', false, 'p1-Jc'),
      card('Q', 'clubs', false, 'p1-Qc'),
      card('K', 'spades', false, 'p1-Ks'),
      card('Q', 'diamonds', true, 'p1-Qd'),
      card('10', 'hearts', true, 'p1-10h'),
    ];
    // p4 (opp, black10) at handSize 13 — triggers "opp ≥ 8 active" condition
    const p4Hand: Card[] = [
      card('5', 'diamonds', true, 'p4-5d'),
      card('6', 'diamonds', true, 'p4-6d'),
      card('7', 'diamonds', true, 'p4-7d'),
      card('8', 'diamonds', true, 'p4-8d'),
      card('9', 'spades', false, 'p4-9s'),
      card('10', 'clubs', false, 'p4-10c'),
      card('J', 'diamonds', true, 'p4-Jd'),
      card('Q', 'spades', false, 'p4-Qs'),
      card('K', 'diamonds', true, 'p4-Kd'),
      card('A', 'diamonds', true, 'p4-Ad'),
      card('A', 'spades', false, 'p4-As'),
      card('A', 'hearts', true, 'p4-Ah'),
      card('2', 'clubs', false, 'p4-2c'),
    ];

    const engine = new GameEngine('m5-test-p6', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'black10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    // p2, p3, p5: small filler. Mix teams to keep p4 + p0 as opps.
    state.players[2].hand = [card('5', 'spades', false, 'p2-5s'), card('6', 'spades', false, 'p2-6s')];
    state.players[2].handSize = 2;
    state.players[2].team = 'red10'; // teammate to bot — ensures opp_min stays at 8
    state.players[3].hand = [card('7', 'spades', false, 'p3-7s'), card('8', 'spades', false, 'p3-8s')];
    state.players[3].handSize = 2;
    state.players[3].team = 'red10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'black10';
    state.players[5].hand = [card('5', 'hearts', true, 'p5-5h')];
    state.players[5].handSize = 1;
    state.players[5].team = 'red10';
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    // p0 plays 8×3 bomb
    const playResult = engine.playCards('p0', [p0Hand[0], p0Hand[1], p0Hand[2]]);
    expect(playResult.success).toBe(true);

    // p1 acts. opp set = {p0, p4} (black10). opp_min = min(5, 13) = 5 (p0
    // played 3 cards from 8 → 5). highThreat=false (opp_min > 2).
    // isLastPlayerDangerous (p0 ≤ 3)? p0 at 5 > 3 → false. → P6 conservation.
    // Without M5: bot bombs (9-bomb beats 8-bomb).
    // With M5: opp p4 at handSize 13 ≥ 8 → guard fires → pass.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  it('still bombs in P6 bomb-vs-bomb when no opp at ≥ 8 cards', () => {
    // Same scenario but all other opps at < 8 cards. M5 guard does not fire,
    // so bot escalates with 9-bomb.
    const p0Hand: Card[] = [
      card('8', 'clubs', false, 'p0-8c1'),
      card('8', 'clubs', false, 'p0-8c2'),
      card('8', 'spades', false, 'p0-8s'),
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'spades', false, 'p0-6s'),
    ];
    const p1Hand: Card[] = [
      card('9', 'clubs', false, 'p1-9c1'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'diamonds', true, 'p1-9d'),
      card('5', 'clubs', false, 'p1-5c'),
      card('6', 'clubs', false, 'p1-6c'),
      card('10', 'hearts', true, 'p1-10h'),
    ];
    const filler = (tag: string, n: number): Card[] =>
      Array.from({ length: n }, (_, i) => card('5', 'hearts', true, `${tag}-${i}`));

    const engine = new GameEngine('m5-test-no-bigopp', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'black10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10';
    state.players[2].hand = filler('p2', 4);
    state.players[2].handSize = 4;
    state.players[2].team = 'red10';
    // p3 = OPP (black10) but at only 7 cards (< 8) → M5 guard doesn't fire
    state.players[3].hand = filler('p3', 7);
    state.players[3].handSize = 7;
    state.players[3].team = 'black10';
    state.players[4].hand = filler('p4', 5);
    state.players[4].handSize = 5;
    state.players[4].team = 'red10';
    state.players[5].hand = filler('p5', 4);
    state.players[5].handSize = 4;
    state.players[5].team = 'red10';
    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0], p0Hand[1], p0Hand[2]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.every(c => c.rank === '9')).toBe(true);
    }
  });
});

// ---- Fix M-Sprint: 4-player team sprint deference ----

describe('Fix M-Sprint — defer marginal beats to smaller-hand teammate on 4-team', () => {
  it('passes A-single beat when 4-team has smaller-hand active teammate (H4RH R5-R8)', () => {
    // 4-team bot at 6 cards, smaller-hand teammate at 3 cards.
    // Opp leads K♣ single. Bot's only beat is A♥ (playMinRank=11). No bomb.
    // Sprint deference must fire → pass instead of burning the A.
    const p0Hand: Card[] = [
      card('K', 'clubs', false, 'p0-Kc'), // lead
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'spades', false, 'p0-7s'),
      card('10', 'hearts', true, 'p0-10h'), // p0 holds a red 10 (red10 team)
      card('Q', 'diamonds', true, 'p0-Qd'),
      card('8', 'diamonds', true, 'p0-8d'),
    ];
    // p1 = bot (black10, 4-team), 6 cards: A♥ + 5 lows below K
    const p1Hand: Card[] = [
      card('A', 'hearts', true, 'p1-Ah'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('7', 'hearts', true, 'p1-7h'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
    ];
    // p2 = teammate sprinter, 3 cards
    const p2Hand: Card[] = [
      card('3', 'clubs', false, 'p2-3c'),
      card('4', 'spades', false, 'p2-4s'),
      card('5', 'clubs', false, 'p2-5c'),
    ];
    // p3 = opp, 7 cards (no Ks → no cha-go on lead)
    const p3Hand: Card[] = [
      card('10', 'diamonds', true, 'p3-10d'),
      card('4', 'hearts', true, 'p3-4h'),
      card('6', 'clubs', false, 'p3-6c'),
      card('8', 'hearts', true, 'p3-8h'),
      card('9', 'hearts', true, 'p3-9h'),
      card('J', 'spades', false, 'p3-Js'),
      card('2', 'diamonds', true, 'p3-2d'),
    ];
    // p4 = teammate, 5 cards
    const p4Hand: Card[] = [
      card('3', 'spades', false, 'p4-3s'),
      card('4', 'clubs', false, 'p4-4c'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('7', 'clubs', false, 'p4-7c'),
      card('8', 'hearts', true, 'p4-8h2'),
    ];
    // p5 = teammate, 4 cards
    const p5Hand: Card[] = [
      card('3', 'hearts', true, 'p5-3h'),
      card('4', 'diamonds', true, 'p5-4d'),
      card('6', 'hearts', true, 'p5-6h'),
      card('9', 'clubs', false, 'p5-9c'),
    ];

    const engine = setupPlayingEngine(
      [p0Hand, p1Hand, p2Hand, p3Hand, p4Hand, p5Hand],
      ['red10', 'black10', 'black10', 'red10', 'black10', 'black10'],
      [p0Hand[0]], // K♣ single
    );

    // Sanity: round has lastPlay (K♣) and no cha-go (no other player has 2+ Ks).
    const roundState = engine.getState().round;
    expect(roundState?.lastPlay?.format).toBe('single');
    expect(roundState?.lastPlay?.cards[0].rank).toBe('K');
    expect(roundState?.chaGoState).toBeNull();

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Sprint deference should fire — A is a power card, smaller-hand teammate
    // (p2 at 3 cards) hasn't passed, my team has 4 members.
    expect(decision.action).toBe('pass');
  });

  it('does NOT defer when bot itself is the sprinter (smallest hand on team)', () => {
    // Same shape as above, but p1 has only 3 cards (bot is sprinter), p2 has 6.
    const p0Hand: Card[] = [
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'spades', false, 'p0-7s'),
      card('10', 'hearts', true, 'p0-10h'),
      card('Q', 'diamonds', true, 'p0-Qd'),
      card('8', 'diamonds', true, 'p0-8d'),
    ];
    // p1 = bot, 3 cards including A♥
    const p1Hand: Card[] = [
      card('A', 'hearts', true, 'p1-Ah'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
    ];
    // p2 = teammate, 6 cards (NOT the sprinter — bigger hand than bot)
    const p2Hand: Card[] = [
      card('3', 'clubs', false, 'p2-3c'),
      card('4', 'spades', false, 'p2-4s'),
      card('5', 'clubs', false, 'p2-5c'),
      card('7', 'hearts', true, 'p2-7h2'),
      card('8', 'spades', false, 'p2-8s2'),
      card('9', 'spades', false, 'p2-9s2'),
    ];
    const p3Hand: Card[] = [
      card('10', 'diamonds', true, 'p3-10d'),
      card('4', 'hearts', true, 'p3-4h'),
      card('6', 'clubs', false, 'p3-6c'),
      card('8', 'hearts', true, 'p3-8h'),
      card('9', 'hearts', true, 'p3-9h'),
      card('J', 'spades', false, 'p3-Js'),
      card('2', 'diamonds', true, 'p3-2d'),
    ];
    const p4Hand: Card[] = [
      card('3', 'spades', false, 'p4-3s'),
      card('4', 'clubs', false, 'p4-4c'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('7', 'clubs', false, 'p4-7c'),
      card('8', 'hearts', true, 'p4-8h2'),
    ];
    const p5Hand: Card[] = [
      card('3', 'hearts', true, 'p5-3h'),
      card('4', 'diamonds', true, 'p5-4d'),
      card('6', 'hearts', true, 'p5-6h'),
      card('9', 'clubs', false, 'p5-9c'),
    ];

    const engine = setupPlayingEngine(
      [p0Hand, p1Hand, p2Hand, p3Hand, p4Hand, p5Hand],
      ['red10', 'black10', 'black10', 'red10', 'black10', 'black10'],
      [p0Hand[0]],
    );

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Bot is sprinter — must play, not defer. Near-exit branch (handSize=3,
    // play.length=1, 3-1=2 ≤ 2) actually returns play here.
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards[0].rank).toBe('A');
    }
  });

  it('does NOT defer when team has only 3 members (3v3 game)', () => {
    // Same hand shape as the positive test, but team split is 3v3 instead of
    // 2v4. Sprint deference is gated on myTeamSize === 4.
    const p0Hand: Card[] = [
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('6', 'diamonds', true, 'p0-6d'),
      card('7', 'spades', false, 'p0-7s'),
      card('10', 'hearts', true, 'p0-10h'),
      card('Q', 'diamonds', true, 'p0-Qd'),
      card('8', 'diamonds', true, 'p0-8d'),
    ];
    const p1Hand: Card[] = [
      card('A', 'hearts', true, 'p1-Ah'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('7', 'hearts', true, 'p1-7h'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
    ];
    const p2Hand: Card[] = [
      card('3', 'clubs', false, 'p2-3c'),
      card('4', 'spades', false, 'p2-4s'),
      card('5', 'clubs', false, 'p2-5c'),
    ];
    const p3Hand: Card[] = [
      card('10', 'diamonds', true, 'p3-10d'),
      card('4', 'hearts', true, 'p3-4h'),
      card('6', 'clubs', false, 'p3-6c'),
      card('8', 'hearts', true, 'p3-8h'),
      card('9', 'hearts', true, 'p3-9h'),
      card('J', 'spades', false, 'p3-Js'),
      card('2', 'diamonds', true, 'p3-2d'),
    ];
    const p4Hand: Card[] = [
      card('3', 'spades', false, 'p4-3s'),
      card('4', 'clubs', false, 'p4-4c'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('7', 'clubs', false, 'p4-7c'),
      card('8', 'hearts', true, 'p4-8h2'),
    ];
    const p5Hand: Card[] = [
      card('10', 'hearts', true, 'p5-10h2'), // p5 on red10 (3v3 split)
      card('3', 'hearts', true, 'p5-3h'),
      card('4', 'diamonds', true, 'p5-4d'),
      card('6', 'hearts', true, 'p5-6h'),
    ];

    const engine = setupPlayingEngine(
      [p0Hand, p1Hand, p2Hand, p3Hand, p4Hand, p5Hand],
      // 3v3 split: p0, p3, p5 = red10; p1, p2, p4 = black10
      ['red10', 'black10', 'black10', 'red10', 'black10', 'red10'],
      [p0Hand[0]],
    );

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Team size = 3, sprint deference should NOT fire. Bot plays A♥.
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards[0].rank).toBe('A');
    }
  });

  it('does NOT defer when an opponent is at 3 cards (medThreat overrides sprint)', () => {
    // 4-team setup with smaller-hand teammate (would normally trigger
    // deference), BUT an opp is at 3 cards — medThreat takes precedence so
    // the bot blocks rather than deferring.
    const p0Hand: Card[] = [
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    // p1 = bot (4-team), 6 cards
    const p1Hand: Card[] = [
      card('A', 'hearts', true, 'p1-Ah'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('7', 'hearts', true, 'p1-7h'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
    ];
    // p2 = teammate, 3 cards (would be sprinter)
    const p2Hand: Card[] = [
      card('3', 'clubs', false, 'p2-3c'),
      card('4', 'spades', false, 'p2-4s'),
      card('5', 'clubs', false, 'p2-5c'),
    ];
    // p3 = opp at 3 cards → medThreat
    const p3Hand: Card[] = [
      card('10', 'diamonds', true, 'p3-10d'),
      card('4', 'hearts', true, 'p3-4h'),
      card('6', 'clubs', false, 'p3-6c'),
    ];
    const p4Hand: Card[] = [
      card('3', 'spades', false, 'p4-3s'),
      card('4', 'clubs', false, 'p4-4c'),
      card('5', 'diamonds', true, 'p4-5d'),
      card('7', 'clubs', false, 'p4-7c'),
    ];
    const p5Hand: Card[] = [
      card('3', 'hearts', true, 'p5-3h'),
      card('4', 'diamonds', true, 'p5-4d'),
      card('6', 'hearts', true, 'p5-6h'),
      card('9', 'clubs', false, 'p5-9c'),
    ];

    const engine = setupPlayingEngine(
      [p0Hand, p1Hand, p2Hand, p3Hand, p4Hand, p5Hand],
      ['red10', 'black10', 'black10', 'red10', 'black10', 'black10'],
      [p0Hand[0]],
    );

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // p3 at 3 cards (medThreat). Sprint deference disabled — must block.
    // medThreat path plays non-bombs freely (A♥ is non-bomb). Bot plays A♥.
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards[0].rank).toBe('A');
    }
  });
});

// ---- Fix M-Reveal: reveal-aware cha cost ----

describe('Fix M-Reveal — fast-track cha when opp trigger reveals via red 10', () => {
  const realRandom = Math.random;
  afterEach(() => { Math.random = realRandom; });

  it('cha on red-10 opp trigger with ≤ 3 copies remaining (H4RH R4 Dave)', () => {
    Math.random = () => 0.99; // no miscount

    // Reproduces H4RH R4: test (red10) plays 10♦ single → cha-go waiting_cha
    // on 10s. Bot Dave (black10) holds 10♣ + 10♣2 (pair of black 10s). Pre-fix
    // afterChaRemaining = 6-2-1 = 3, falls through speculative gates (only
    // ≤2 random gates fire), ends at decline. Post-fix: triggerHadRedTen=true,
    // afterChaRemaining=3 ≤ 3 → 'cha'.
    const p0Hand: Card[] = [
      card('10', 'diamonds', true, 'p0-10d'), // RED 10 trigger
      card('5', 'spades', false, 'p0-5s'),
      card('Q', 'clubs', false, 'p0-Qc'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    // p1 = bot (black10), holds pair of black 10s.
    // Hand intentionally lacks a 5+-card straight so the speculative
    // hand-shaping path doesn't fire — isolates the reveal-aware gate.
    const p1Hand: Card[] = [
      card('10', 'clubs', false, 'p1-10c'),
      card('10', 'clubs', false, 'p1-10c2'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
    ];
    // p2-p5: filler. Distribute remaining 3 copies of '10' among players to
    // bring total visible 10s to 6 (1.5 decks).
    const filler = (tag: string): Card[] => [
      card('3', 'spades', false, `${tag}-3s`),
      card('4', 'clubs', false, `${tag}-4c`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('Q', 'hearts', true, `${tag}-Qh`),
    ];
    const p2Hand: Card[] = [
      card('10', 'spades', false, 'p2-10s'),
      ...filler('p2').slice(0, 3),
    ];
    const p3Hand: Card[] = [
      card('10', 'hearts', true, 'p3-10h'), // p3 = red10 (held a red 10)
      ...filler('p3').slice(0, 3),
    ];
    const p4Hand: Card[] = [
      card('10', 'hearts', true, 'p4-10h2'), // p4 = red10
      ...filler('p4').slice(0, 3),
    ];
    const p5Hand = filler('p5');

    const engine = new GameEngine('reveal-r4', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10'; // opponent
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10'; // bot
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'black10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'red10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    const playResult = engine.playCards('p0', [p0Hand[0]]); // play 10♦
    expect(playResult.success).toBe(true);

    const roundState = engine.getState().round;
    expect(roundState?.chaGoState?.phase).toBe('waiting_cha');
    expect(roundState?.chaGoState?.triggerRank).toBe('10');
    expect(roundState?.lastPlay?.cards.some(c => c.rank === '10' && c.isRed)).toBe(true);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Reveal-aware cha must fire — opp just outed themselves via red 10.
    expect(decision.action).toBe('cha');
    if (decision.action === 'cha') {
      expect(decision.cards.every(c => c.rank === '10')).toBe(true);
    }
  });

  it('does NOT fire on black-10 opp trigger (no reveal, falls to standard speculative)', () => {
    // Pin random so the speculative ≤2 random gates DECLINE.
    Math.random = () => 0.99;

    // Same setup as above but p0 plays a BLACK 10 (no team reveal). Reveal-aware
    // gate disabled, speculative gate at afterChaRemaining=3 → decline.
    const p0Hand: Card[] = [
      card('10', 'spades', false, 'p0-10s'), // BLACK 10 (not a reveal)
      card('5', 'spades', false, 'p0-5s'),
      card('10', 'hearts', true, 'p0-10h'), // p0 still on red10 (holds red 10)
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    // Hand intentionally lacks a 5+-card straight after removing the 10-pair.
    const p1Hand: Card[] = [
      card('10', 'clubs', false, 'p1-10c'),
      card('10', 'clubs', false, 'p1-10c2'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
    ];
    const filler = (tag: string): Card[] => [
      card('3', 'spades', false, `${tag}-3s`),
      card('4', 'clubs', false, `${tag}-4c`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('Q', 'hearts', true, `${tag}-Qh2`),
    ];
    const p2Hand: Card[] = [
      card('10', 'diamonds', true, 'p2-10d'),
      ...filler('p2').slice(0, 3),
    ];
    const p3Hand: Card[] = [
      ...filler('p3'),
    ];
    const p4Hand: Card[] = [
      card('10', 'hearts', true, 'p4-10h2'),
      ...filler('p4').slice(0, 3),
    ];
    const p5Hand = filler('p5');

    const engine = new GameEngine('reveal-black10', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]); // play black 10♠

    const roundState = engine.getState().round;
    expect(roundState?.lastPlay?.cards.some(c => c.rank === '10' && c.isRed)).toBe(false);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // No reveal → falls to speculative gate at afterChaRemaining=3, declines.
    expect(decision.action).toBe('decline_cha');
  });

  it('does NOT fire when teammate plays the red 10 (steals teammate trick)', () => {
    Math.random = () => 0.99;

    // p0 (TEAMMATE of bot) plays 10♦ red 10. Even though red 10 reveals
    // teammate as red10 (presumably already known/inferred), cha-ing a
    // teammate's lead steals their trick. The !triggerIsTeammate guard
    // outside the reveal-aware gate prevents this.
    const p0Hand: Card[] = [
      card('10', 'diamonds', true, 'p0-10d'),
      card('5', 'spades', false, 'p0-5s'),
      card('Q', 'clubs', false, 'p0-Qc'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    // Hand intentionally lacks a 5+-card straight after removing the 10-pair.
    const p1Hand: Card[] = [
      card('10', 'clubs', false, 'p1-10c'),
      card('10', 'clubs', false, 'p1-10c2'),
      card('5', 'hearts', true, 'p1-5h'),
      card('6', 'spades', false, 'p1-6s'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('8', 'spades', false, 'p1-8s'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'spades', false, 'p1-Js'),
    ];
    const filler = (tag: string): Card[] => [
      card('3', 'spades', false, `${tag}-3s`),
      card('4', 'clubs', false, `${tag}-4c`),
      card('6', 'diamonds', true, `${tag}-6d`),
      card('Q', 'hearts', true, `${tag}-Qh2`),
    ];
    const p2Hand: Card[] = [
      card('10', 'spades', false, 'p2-10s'),
      ...filler('p2').slice(0, 3),
    ];
    const p3Hand: Card[] = [
      card('10', 'hearts', true, 'p3-10h'),
      ...filler('p3').slice(0, 3),
    ];
    const p4Hand: Card[] = [
      card('10', 'hearts', true, 'p4-10h2'),
      ...filler('p4').slice(0, 3),
    ];
    const p5Hand = filler('p5');

    const engine = new GameEngine('reveal-teammate', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10'; // TEAMMATE of bot
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'red10'; // bot
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'black10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'red10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Teammate trigger — reveal-aware gate gated behind !triggerIsTeammate.
    // Falls to final return 'decline'.
    expect(decision.action).toBe('decline_cha');
  });
});

// ---- Fix M-OppBomb: team-aware bomb-guard relaxation ----

describe('Fix M-OppBomb — relax bomb-deploy guards when bombing a publicly-confirmed opponent', () => {
  it('bombs over an opp 2-single with a small bomb (single-bomb-guard relaxed)', () => {
    // opp p0 at handSize 3 leads 2♥ → handSize 2 after play → highThreat.
    // Inside effectivelyHighThreat, single-bomb-guard would normally pass.
    // Carve-out: confirmed opp + 2-single + small bomb (rank 5) → play bomb.
    const p0Hand: Card[] = [
      card('2', 'hearts', true, 'p0-2h'),
      card('10', 'hearts', true, 'p0-10h'),
      card('K', 'clubs', false, 'p0-Kc'),
    ];
    const p1Hand: Card[] = [
      card('5', 'spades', false, 'p1-5s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('5', 'hearts', true, 'p1-5h2'),
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'clubs', false, 'p1-Jc'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['3', '4', '6', '7', '8', '9', 'Q', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'spades', false, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 4)];
    const p3Hand = filler('p3', 5);
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 4)];
    const p5Hand = filler('p5', 5);

    const engine = new GameEngine('oppbomb-single', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[0].revealedRed10Count = 1; // PUBLICLY revealed
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]); // play 2♥

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
      expect(decision.cards.length).toBe(3);
    }
  });

  it('does NOT relax single-bomb-guard when last player is unconfirmed opp', () => {
    // p0 has NOT revealed (revealedRed10Count = 0, teamsRevealed = false).
    const p0Hand: Card[] = [
      card('2', 'hearts', true, 'p0-2h'),
      card('K', 'clubs', false, 'p0-Kc'),
      card('Q', 'spades', false, 'p0-Qs'),
    ];
    const p1Hand: Card[] = [
      card('5', 'spades', false, 'p1-5s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('5', 'hearts', true, 'p1-5h2'),
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
      card('9', 'spades', false, 'p1-9s'),
      card('J', 'clubs', false, 'p1-Jc'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['3', '4', '6', '7', '8', '9', 'Q', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'spades', false, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'hearts', true, 'p2-10h'), ...filler('p2', 4)];
    const p3Hand = filler('p3', 5);
    const p4Hand = [card('10', 'diamonds', true, 'p4-10d'), ...filler('p4', 4)];
    const p5Hand = filler('p5', 5);

    const engine = new GameEngine('oppbomb-unconfirmed', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[0].revealedRed10Count = 0; // NOT revealed
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  it('relaxes M5 sandwich guard for confirmed opp bomb-vs-bomb', () => {
    // opp p0 leads a 5×3 bomb (revealed) and an 8+-card opp (p3) is still
    // active. Bot p1 has 9×3 (cheapest beat). With confirmed-opp relaxation,
    // M5 doesn't pass — bot bombs.
    const p0Hand: Card[] = [
      card('5', 'spades', false, 'p0-5s'),
      card('5', 'hearts', true, 'p0-5h'),
      card('5', 'hearts', true, 'p0-5h2'),
      card('10', 'hearts', true, 'p0-10h'),
      card('K', 'clubs', false, 'p0-Kc'),
    ];
    const p1Hand: Card[] = [
      card('9', 'spades', false, 'p1-9s'),
      card('9', 'hearts', true, 'p1-9h'),
      card('9', 'hearts', true, 'p1-9h2'),
      card('J', 'clubs', false, 'p1-Jc'),
      card('Q', 'spades', false, 'p1-Qs'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['3', '4', '6', '7', '8', 'J', 'Q'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'spades', false, `${tag}-${i}`),
      );
    };
    const p3Hand = filler('p3', 9); // 8+-card opp triggers sandwich condition
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 4)];
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 4)];
    const p5Hand = filler('p5', 5);

    const engine = new GameEngine('oppbomb-sandwich', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[0].revealedRed10Count = 1;
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'red10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0], p0Hand[1], p0Hand[2]]); // 5×3 bomb

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.every(c => c.rank === '9')).toBe(true);
    }
  });
});

// ---- Fix M-Stranded: burn-to-win when stranded low cards + extra power ----

describe('Fix M-Stranded — play 2-single or bomb to win round when holding stranded low + extra power', () => {
  it('plays 2-single (preferred over bomb) when stranded orphan + ≥ 2 twos', () => {
    // opp leads K♣. Bot has stranded 3♣ orphan + 2 twos (extra power) +
    // 1 bomb (Q×3). M-Stranded fires; prefers 2-single over bomb.
    const p0Hand: Card[] = [
      card('K', 'clubs', false, 'p0-Kc'),
      card('5', 'spades', false, 'p0-5s'),
      card('7', 'hearts', true, 'p0-7h'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c'), // stranded orphan
      card('2', 'hearts', true, 'p1-2h'),
      card('2', 'spades', false, 'p1-2s'),
      card('Q', 'spades', false, 'p1-Qs'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('Q', 'clubs', false, 'p1-Qc'),
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
      card('J', 'clubs', false, 'p1-Jc'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['4', '5', '6', '7', '8', '9', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'diamonds', true, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 6)];
    const p3Hand = filler('p3', 7);
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 6)];
    const p5Hand = filler('p5', 7);

    const engine = new GameEngine('stranded-twos', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('2');
    }
  });

  it('plays smallest bomb when stranded + ≥ 2 bombs but no winning 2-single available', () => {
    // opp leads 2♣ single. Bot has stranded 3♣ orphan, 1 two, and 2 bombs
    // (5×3 + Q×3). The single 2 in hand can't beat 2♣ (same rank).
    // M-Stranded picks the smallest bomb (5×3).
    const p0Hand: Card[] = [
      card('2', 'clubs', false, 'p0-2c'),
      card('10', 'hearts', true, 'p0-10h'),
      card('K', 'clubs', false, 'p0-Kc'),
      card('Q', 'spades', false, 'p0-Qs'),
    ];
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c'), // stranded orphan
      card('5', 'spades', false, 'p1-5s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('5', 'hearts', true, 'p1-5h2'),
      card('Q', 'spades', false, 'p1-Qs'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('Q', 'clubs', false, 'p1-Qc'),
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['4', '6', '7', '8', '9', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'diamonds', true, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 6)];
    const p3Hand = filler('p3', 7);
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 6)];
    const p5Hand = filler('p5', 7);

    const engine = new GameEngine('stranded-bombs', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(3);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });

  it('does NOT fire when no stranded low card', () => {
    // opp leads 9♣. Bot's only beats are A or 2 (no J, K, etc.). Conservation
    // suppresses A-on-9 (`playMinRank >= 11 && lastPlayMaxRank < 9`) → pass.
    // M-Stranded would otherwise override BUT no stranded card exists.
    const p0Hand: Card[] = [
      card('9', 'clubs', false, 'p0-9c'),
      card('5', 'spades', false, 'p0-5s'),
      card('7', 'hearts', true, 'p0-7h'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    // No rank ≤ 5 orphan, no straight starting at 3.
    const p1Hand: Card[] = [
      card('2', 'hearts', true, 'p1-2h'),
      card('2', 'spades', false, 'p1-2s'),
      card('Q', 'spades', false, 'p1-Qs'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('Q', 'clubs', false, 'p1-Qc'),
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
      card('9', 'hearts', true, 'p1-9h'),
      card('A', 'hearts', true, 'p1-Ah'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['4', '6', '7', '8', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'diamonds', true, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 6)];
    const p3Hand = filler('p3', 7);
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 6)];
    const p5Hand = filler('p5', 7);

    const engine = new GameEngine('stranded-none', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  it('does NOT fire when extra-power condition fails (only 1 bomb + 1 two)', () => {
    // opp leads 9♣. Bot has stranded 3♣ but only 1 two + 1 bomb (Q×3).
    // hasExtraPower=false (need ≥ 2 bombs OR ≥ 2 twos). Conservation
    // suppresses A-on-9 → pass.
    const p0Hand: Card[] = [
      card('9', 'clubs', false, 'p0-9c'),
      card('5', 'spades', false, 'p0-5s'),
      card('7', 'hearts', true, 'p0-7h'),
      card('Q', 'spades', false, 'p0-Qs'),
      card('10', 'hearts', true, 'p0-10h'),
    ];
    const p1Hand: Card[] = [
      card('3', 'clubs', false, 'p1-3c'), // stranded
      card('2', 'hearts', true, 'p1-2h'), // ONE two
      card('Q', 'spades', false, 'p1-Qs'),
      card('Q', 'hearts', true, 'p1-Qh'),
      card('Q', 'clubs', false, 'p1-Qc'), // ONE bomb (Q×3)
      card('7', 'spades', false, 'p1-7s'),
      card('8', 'hearts', true, 'p1-8h'),
      card('A', 'hearts', true, 'p1-Ah'),
      card('9', 'hearts', true, 'p1-9h'),
    ];
    const filler = (tag: string, n: number): Card[] => {
      const ranks = ['4', '6', '7', '8', 'J'];
      return Array.from({ length: n }, (_, i) =>
        card(ranks[i % ranks.length] as Card['rank'], 'diamonds', true, `${tag}-${i}`),
      );
    };
    const p2Hand = [card('10', 'diamonds', true, 'p2-10d'), ...filler('p2', 6)];
    const p3Hand = filler('p3', 7);
    const p4Hand = [card('10', 'hearts', true, 'p4-10h2'), ...filler('p4', 6)];
    const p5Hand = filler('p5', 7);

    const engine = new GameEngine('stranded-no-extra', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = 'red10';
    state.players[1].hand = p1Hand;
    state.players[1].handSize = p1Hand.length;
    state.players[1].team = 'black10';
    state.players[2].hand = p2Hand;
    state.players[2].handSize = p2Hand.length;
    state.players[2].team = 'red10';
    state.players[3].hand = p3Hand;
    state.players[3].handSize = p3Hand.length;
    state.players[3].team = 'black10';
    state.players[4].hand = p4Hand;
    state.players[4].handSize = p4Hand.length;
    state.players[4].team = 'red10';
    state.players[5].hand = p5Hand;
    state.players[5].handSize = p5Hand.length;
    state.players[5].team = 'black10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');
    engine.playCards('p0', [p0Hand[0]]);

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // Stranded but extraPower=false → conservation governs → pass.
    expect(decision.action).toBe('pass');
  });
});
