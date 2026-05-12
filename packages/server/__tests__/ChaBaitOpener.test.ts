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

/**
 * Build an engine in the opening position for p0.
 * p0Hand: cards assigned to p0
 * opts.teamsRevealed: set doubling.teamsRevealed
 * opts.p1HandSize: handSize for p1 (teammate)
 * opts.p1RevealedRed10Count: revealedRed10Count for p1
 * opts.p1Team: team for p1 (default 'red10')
 * opts.p0Team: team for p0 (default 'red10')
 */
function setupChaBaitEngine(
  p0Hand: Card[],
  opts: {
    teamsRevealed?: boolean;
    p1HandSize?: number;
    p1RevealedRed10Count?: number;
    p1Team?: 'red10' | 'black10';
    p0Team?: 'red10' | 'black10';
  } = {},
): GameEngine {
  const engine = new GameEngine('cha-bait-test', makePlayers());
  engine.startGame();

  const state = engine.getState();

  // Set p0's hand
  state.players[0].hand = p0Hand;
  state.players[0].handSize = p0Hand.length;
  state.players[0].team = opts.p0Team ?? 'red10';

  // p1 is same-team teammate
  const p1HandSize = opts.p1HandSize ?? 8;
  const p1Filler: Card[] = Array.from({ length: p1HandSize }, (_, i) =>
    card('J', 'clubs', false, `p1-filler-${i}`)
  );
  state.players[1].hand = p1Filler;
  state.players[1].handSize = p1HandSize;
  state.players[1].team = opts.p1Team ?? 'red10';
  state.players[1].revealedRed10Count = opts.p1RevealedRed10Count ?? 0;

  // Other players (p2-p5) get large filler hands on the OPPOSING team to p0,
  // ensuring only p1 is a same-team teammate. This isolates the bait condition.
  const filler: Card[] = Array.from({ length: 8 }, (_, i) =>
    card('J', 'clubs', false, `filler-other-${i}`)
  );
  const opposingTeam = (opts.p0Team ?? 'red10') === 'red10' ? 'black10' : 'red10';
  for (let i = 2; i < 6; i++) {
    state.players[i].hand = filler;
    state.players[i].handSize = 8;
    state.players[i].team = opposingTeam;
  }

  // Set doubling state
  (state as any).doubling = { teamsRevealed: opts.teamsRevealed ?? false };

  state.phase = 'playing';
  engine.startNewRound('p0');

  return engine;
}

describe('Cha-bait opener bonus', () => {
  // Score analysis for the baseline test hand (hand=7 to trigger large-hand-dump bonus):
  //   Hand: 3♥ + 5♣5♠ + J♣A♣K♥9♦  (hand=7)
  //         Ranks: 3(0),5(2),5(2),J(8),A(11),K(10),9(6)
  //         No 3 consecutive rank values → no straights
  //
  //   3♥ is orphan (no pair, no straight).
  //   5♣5♠ are paired (in usedInMulti), not orphans.
  //
  //   3♥ single score (no bait): 10 + orphan(8) + (12-0)*2 = 10+8+24 = 42
  //   3♥ single score (with bait): 42 + 6 = 48
  //
  //   5-pair score: cards.length*10=20 + (12-2)*2=20 + large-hand-dump(hand=7≥7,cards=2≥2)=6 = 46
  //
  //   Without bait: pair(46) > single(42) → pair wins
  //   With bait:    single(48) > pair(46) → single wins

  it('Test 1: bait fires — singleton 3 chosen over pair when teammate is large and teams revealed', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 8,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(1);
    expect(decision.cards![0].rank).toBe('3');
  });

  it('Test 2: no bait — teammate too small (handSize=3)', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 3,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(2);
  });

  it('Test 3: no bait — teams not publicly revealed and no revealedRed10Count', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: false,
      p1HandSize: 8,
      p1RevealedRed10Count: 0,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(2);
  });

  it('Test 4: no bait — high rank single (10♣, rankValue=7 > 5)', () => {
    // All fillers have rankValue > 5 so no single triggers bait.
    // 10♣ single: score = 10 + orphan(8) + (12-7)*2 = 28. No bait (rankValue=7 > 5).
    // 5-pair: cards*10=20 + (12-2)*2=20 + large-dump(7≥7)=6 = 46. Pair wins.
    // Fillers: J♣(8), A♣(11), 2♦(12), 2♥(12). All rankValues > 5 → no bait for any single.
    const p0Hand: Card[] = [
      card('10', 'clubs', false, 'p0-10c'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('2', 'diamonds', false, 'p0-2d'),
      card('2', 'hearts', true, 'p0-2h'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 8,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(2);
  });

  it('Test 5: no bait — late game (hand=4, < 6 threshold), dump mode leads orphan', () => {
    // hand=4: bait requires hand.length>=6, so no bait. Also isEndgame=true.
    // Hand: [3♥, 5♣, 5♠, J♣]. No bombs, no special bomb → not super-strong.
    // Dump-mode scoring (weak endgame hand):
    //   3♥ single (orphan): 10 + 8 + (12-0)*2 = 42
    //   5-pair: 20 + orphanCount(0)*8 + (12-2)*2 = 40
    //   J♣ single (orphan): 10 + 8 + (12-8)*2 = 26
    // 3♥ wins (42 > 40). Bot leads the low orphan to avoid trapping it.
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 8,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    // Dump mode: orphan 3♥ scores highest → leads single, not pair.
    expect(decision.cards!.length).toBe(1);
    expect(decision.cards![0].rank).toBe('3');
  });

  it('Test 6: bait fires via revealedRed10Count (teamsRevealed=false, p1 revealed red10)', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: false,
      p1HandSize: 8,
      p1RevealedRed10Count: 1,
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(1);
    expect(decision.cards![0].rank).toBe('3');
  });

  it('Test 7: LegacyPreFixesStrategy — bait disabled (disableChaBait=true) → pair picked', () => {
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 8,
    });
    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(2);
  });

  it('Test 8: bait works for black10 team (symmetrical, teamsRevealed=true required)', () => {
    // Bot p0 is black10, p1 is black10 teammate. Teams revealed via doubling.
    // black10 players do not earn revealedRed10Count, so public confirmation
    // requires teamsRevealed=true.
    const p0Hand: Card[] = [
      card('3', 'hearts', true, 'p0-3h'),
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('J', 'clubs', false, 'p0-Jc'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
      card('9', 'diamonds', false, 'p0-9d'),
    ];
    const engine = setupChaBaitEngine(p0Hand, {
      teamsRevealed: true,
      p1HandSize: 8,
      p0Team: 'black10',
      p1Team: 'black10',
    });
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    expect(decision.cards!.length).toBe(1);
    expect(decision.cards![0].rank).toBe('3');
  });
});
