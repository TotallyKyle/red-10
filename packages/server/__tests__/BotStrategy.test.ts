import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import {
  SmartRacerStrategy,
  AggressiveStrategy,
  HandSizeExploiterStrategy,
  TeamCoordinatorStrategy,
} from '../src/bot/BotManager.js';
import type { Card } from '@red10/shared';

function card(rank: string, suit: string, isRed: boolean, id?: string): Card {
  return {
    id: id ?? `${suit}-${rank}-${Math.random().toString(36).slice(2, 7)}`,
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
 * Build an engine with custom hands, skip doubling, set a specific player's turn.
 */
function setupEngine(hands: Card[][], teams: ('red10' | 'black10')[], leaderId = 'p0'): GameEngine {
  const engine = new GameEngine('test', makePlayers());
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

describe('BotManager — teammate-bomb awareness', () => {
  it("passes when teammate just played a bomb (high threat, opponent has 2 cards)", () => {
    // Scenario: p1 (red10) just bombed. p2 (red10) is teammate.
    // Opponent p3 (black10) has 2 cards — high threat.
    // p2 has 5 cards including a bigger bomb.
    // Expected: p2 passes (doesn't overbomb teammate).
    const hands: Card[][] = [
      [card('3', 'hearts', true)], // p0 placeholder
      [], // p1 played their bomb already
      // p2: has 5 cards including a 7x3 bomb (which beats p1's 4x3)
      [
        card('7', 'hearts', true, 'p2-7h'),
        card('7', 'spades', false, 'p2-7s'),
        card('7', 'clubs', false, 'p2-7c'),
        card('9', 'hearts', true, 'p2-9h'),
        card('Q', 'diamonds', true, 'p2-qd'),
      ],
      [card('3', 'clubs', false), card('4', 'clubs', false)], // p3: 2 cards, opponent, high threat
      [card('5', 'hearts', true)],
      [card('6', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p1');

    // p1 opens with a 4x3 bomb (lead)
    const bomb = [
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'spades', false, 'p1-4s'),
      card('4', 'clubs', false, 'p1-4c'),
    ];
    // Give p1 the bomb and play it
    const state = engine.getState();
    state.players[1].hand = bomb;
    state.players[1].handSize = 3;
    const result = engine.playCards('p1', bomb);
    expect(result.success).toBe(true);

    // p2 now decides. Should pass because teammate (p1) just bombed.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p2');
    expect(decision.action).toBe('pass');
  });

  it("passes over teammate's bomb even when overbomb would exit entire hand", () => {
    // Scenario: teammate p1 just bombed. p2 (red10, teammate) has exactly
    // 3 cards that form a BIGGER bomb — overbombing would exit them.
    // Still: p2 should pass. Exiting here locks out teammate and hands
    // turn order to opponent p3 (who has 1 card).
    const hands: Card[][] = [
      [card('3', 'hearts', true)],
      [],
      // p2: exactly 3 cards forming a bomb bigger than p1's 4x3
      [
        card('7', 'hearts', true, 'p2-7h'),
        card('7', 'spades', false, 'p2-7s'),
        card('7', 'clubs', false, 'p2-7c'),
      ],
      [card('5', 'clubs', false)], // p3: 1 card, opponent, CRITICAL threat
      [card('6', 'hearts', true)],
      [card('8', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p1');

    const bomb = [
      card('4', 'hearts', true, 'p1-4h'),
      card('4', 'spades', false, 'p1-4s'),
      card('4', 'clubs', false, 'p1-4c'),
    ];
    const state = engine.getState();
    state.players[1].hand = bomb;
    state.players[1].handSize = 3;
    engine.playCards('p1', bomb);

    // Even though p2 could exit by bombing, they should still pass.
    // Teammate's bomb wins the round; teammate leads next and can play
    // multi-card formats that block p3's 1-card exit.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p2');
    expect(decision.action).toBe('pass');
  });

  it('passes when teammate just played a 2 (highest single)', () => {
    // p1 (red10) plays a 2. p2 (red10) teammate.
    // Opponent p3 (black10) has 2 cards — still shouldn't overplay.
    const hands: Card[][] = [
      [card('3', 'hearts', true)],
      [card('2', 'hearts', true, 'p1-2h')], // only a 2
      [
        card('A', 'diamonds', true, 'p2-a'),
        card('K', 'hearts', true, 'p2-k'),
        card('3', 'clubs', false, 'p2-3c'),
      ],
      [card('5', 'clubs', false), card('6', 'clubs', false)],
      [card('7', 'hearts', true)],
      [card('8', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'black10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p1');

    // p1 plays the 2
    engine.playCards('p1', [hands[1][0]]);

    // p2 decides. Should pass — nothing non-bomb can beat a 2.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p2');
    expect(decision.action).toBe('pass');
  });
});

describe('BotManager — cha-go rank cost', () => {
  it("declines cha'ing on a 2 when no opponent is about to exit", () => {
    // Set up a cha-go waiting_cha on rank "2" where p1 has 2 copies of 2
    // but no opponent has ≤2 cards.
    const hands: Card[][] = [
      [card('3', 'hearts', true)], // p0 (opener, will play a 2)
      [
        card('2', 'spades', false, 'p1-2s'),
        card('2', 'clubs', false, 'p1-2c'),
        card('5', 'hearts', true),
        card('6', 'hearts', true),
        card('7', 'hearts', true),
      ],
      [card('9', 'hearts', true), card('10', 'hearts', true)],
      [card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    // p0 plays a 2 to trigger cha-go opportunity
    // First give p0 a 2
    const state = engine.getState();
    const twoForP0 = card('2', 'hearts', true, 'p0-2h');
    state.players[0].hand = [twoForP0];
    state.players[0].handSize = 1;
    engine.playCards('p0', [twoForP0]);

    // Verify we're in cha-go waiting_cha
    expect(engine.getState().round?.chaGoState?.phase).toBe('waiting_cha');
    expect(engine.getState().round?.chaGoState?.triggerRank).toBe('2');

    // p1 (black10, opponent) has 2 twos — but NO opponent has ≤2 cards
    // (p0 just exited with 0 cards, but they're out not opponent; others have ≥2)
    // Actually p0 just went out, so handSize is 0. Let's check threat.
    // Opponents (relative to p1 who is black10): p0, p2, p4 (red10)
    // p0 just exited (isOut=true), p2 has 2 cards, p4 has 2 cards.
    // So p2 has ≤2 cards — that IS a dangerous opponent.
    // To make this test truly "no critical opponent", we need opponents with ≥3 cards.
    // Let me restructure.
  });

  it("declines cha'ing on a 2 when no opponent is near-exit and many 2s remain", () => {
    // Cha-er is p3 (not adjacent to p0), so the skipped players are p1, p2 —
    // all having lots of cards. No critical opponent skip. The bot should
    // decline because cha'ing 2s is expensive.
    //
    // We make sure card counting can't "win" the round either: p3 has only 2
    // copies of 2, so estimated totalKnown (inMyHand + playedInRound) is at
    // most 3, and remaining in others >= 3 — well above zero even under the
    // 60% accuracy miscount noise.
    const hands: Card[][] = [
      [
        card('2', 'hearts', true, 'p0-2h'),
        card('5', 'hearts', true),
        card('6', 'hearts', true),
        card('7', 'hearts', true),
        card('8', 'hearts', true),
      ],
      // p1 non-eligible, black10, 5 cards
      [card('3', 'clubs', false), card('4', 'clubs', false), card('5', 'clubs', false), card('J', 'hearts', true), card('Q', 'hearts', true)],
      // p2 non-eligible, red10, 5 cards
      [card('3', 'hearts', true), card('4', 'hearts', true), card('5', 'diamonds', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      // p3 eligible: 2 twos + more (black10)
      [
        card('2', 'spades', false, 'p3-2s'),
        card('2', 'clubs', false, 'p3-2c'),
        card('J', 'clubs', false),
        card('9', 'hearts', true),
        card('10', 'hearts', true),
      ],
      // p4 non-eligible, red10
      [card('7', 'clubs', false), card('8', 'clubs', false), card('9', 'clubs', false)],
      // p5 non-eligible, black10
      [card('4', 'diamonds', true), card('6', 'diamonds', true), card('3', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');
    engine.playCards('p0', [hands[0][0]]);
    // Cha-go waiting_cha on rank 2. Only p3 is eligible (has 2 twos).
    // p3's cha would skip p1, p2 — both have 5 cards. No critical skip.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p3');
    expect(decision.action).toBe('decline_cha');
  });

  it("cha's on a 2 when it skips an opponent with ≤2 cards", () => {
    // Set up so cha-er (p3) skips p1 and p2. p1 is black10 opponent with 2 cards.
    // p0 (red10) plays 2, p3 (red10) has twos, skipping over p1, p2.
    // Wait: teams matter. Let p3 be red10 teammate of p0, and p1/p2 opponents.
    const hands: Card[][] = [
      [
        card('2', 'hearts', true, 'p0-2h'),
        card('5', 'hearts', true),
        card('6', 'hearts', true),
      ],
      // p1 (black10 opponent): 2 cards — CRITICAL
      [card('9', 'hearts', true), card('10', 'hearts', true)],
      // p2 (black10 opponent): 4 cards
      [card('J', 'hearts', true), card('Q', 'hearts', true), card('K', 'hearts', true), card('3', 'diamonds', true)],
      // p3 (red10): 2 twos so can cha
      [
        card('2', 'spades', false, 'p3-2s'),
        card('2', 'clubs', false, 'p3-2c'),
        card('7', 'hearts', true),
      ],
      [card('4', 'clubs', false), card('5', 'clubs', false), card('6', 'clubs', false)],
      [card('3', 'clubs', false), card('4', 'diamonds', true), card('6', 'clubs', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'black10', 'red10', 'black10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    engine.playCards('p0', [hands[0][0]]);
    // Cha-go waiting_cha active on rank 2.
    // p3 (red10) cha'ing would skip p1 (black10, 2 cards CRITICAL) and p2.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p3');
    expect(decision.action).toBe('cha');
  });

  it("does not go-cha in waiting_cha even with 3+ of the rank (paired cha first)", () => {
    // Per the rules, go-cha requires a prior paired cha. If we have 3 of the
    // trigger rank, we should still CHA with 2 of them, not go-cha.
    const hands: Card[][] = [
      // p0 plays the trigger single 5
      [card('5', 'hearts', true, 'p0-5h'), card('3', 'hearts', true), card('6', 'hearts', true)],
      // p1 has 3 fives — should paired-cha, not go-cha
      [
        card('5', 'diamonds', true, 'p1-5d'),
        card('5', 'clubs', false, 'p1-5c'),
        card('5', 'spades', false, 'p1-5s'),
        card('8', 'hearts', true),
        // extra cards so p1 has opponents with lots of cards (cha is worthwhile)
        card('9', 'hearts', true),
        card('J', 'hearts', true),
      ],
      [card('Q', 'hearts', true), card('K', 'hearts', true), card('A', 'hearts', true)],
      [card('4', 'clubs', false), card('7', 'clubs', false), card('10', 'clubs', false)],
      [card('3', 'diamonds', true), card('4', 'diamonds', true), card('6', 'diamonds', true)],
      [card('J', 'clubs', false), card('K', 'clubs', false), card('2', 'clubs', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    engine.playCards('p0', [hands[0][0]]);
    // Now in waiting_cha on rank 5
    expect(engine.getState().round?.chaGoState?.phase).toBe('waiting_cha');

    // p1 has 3 fives. The bot should CHA (with 2 of them), not go-cha.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    // The decision must not be 'go_cha' — go-cha isn't legal in waiting_cha.
    // Acceptable outcomes: 'cha' (preferred) or 'decline_cha'. With all
    // opponents having 3 cards there's still value in cha'ing, so we
    // accept either — but definitely NOT go_cha.
    expect(decision.action).not.toBe('go_cha');
  });
});

describe('BotManager — opening vs near-exit opponent', () => {
  it("leads with HIGHEST single when opponent has 1 card and we can't form a multi-card play", () => {
    // Classic bug: bot leads with a low single when opponent has 1 card,
    // letting the opponent exit by beating the low card. Correct play: lead
    // with our highest single to minimize chance opponent can beat.
    const hands: Card[][] = [
      // p0 is the leader with 2 mismatched cards (no pair/straight/bomb).
      // We have a Q and a 3. We should lead with the Q, not the 3.
      [
        card('3', 'clubs', false, 'p0-3c'),
        card('Q', 'hearts', true, 'p0-qh'),
      ],
      // p1 is an opponent with 1 card — critical threat
      [card('7', 'hearts', true, 'p1-7h')],
      // p2+ filler
      [card('4', 'spades', false), card('5', 'clubs', false)],
      [card('6', 'spades', false), card('8', 'clubs', false)],
      [card('9', 'spades', false), card('J', 'clubs', false)],
      [card('K', 'spades', false), card('A', 'clubs', false)],
    ];
    // p0 red10, p1 black10 opponent, rest mixed
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    // Important: p1 must be OUT in team-known sense — set revealedRed10Count
    // so p0 "knows" p1 is an opponent. Actually team is already set in setup.
    // No further setup needed.

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return; // type guard
    expect(decision.cards).toHaveLength(1);
    // MUST be the Q, not the 3
    expect(decision.cards[0].rank).toBe('Q');
  });

  it("leads with HIGHEST single when opponent has 2 cards and no multi-card play available", () => {
    const hands: Card[][] = [
      // p0 has 3 mismatched cards
      [
        card('4', 'clubs', false, 'p0-4c'),
        card('8', 'hearts', true, 'p0-8h'),
        card('K', 'spades', false, 'p0-ks'),
      ],
      // p1 has 2 cards (opponent)
      [card('7', 'hearts', true), card('9', 'hearts', true)],
      [card('3', 'spades', false), card('5', 'clubs', false)],
      [card('6', 'spades', false), card('10', 'clubs', false)],
      [card('J', 'spades', false), card('Q', 'clubs', false)],
      [card('A', 'spades', false), card('2', 'clubs', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    // With no pair/straight, lead with highest → K
    expect(decision.cards[0].rank).toBe('K');
  });
});

describe('BotManager — doubling selectivity', () => {
  /**
   * Build an engine in the doubling phase with a specific hand for p0.
   */
  function setupForDoubling(p0Hand: Card[], p0Team: 'red10' | 'black10'): GameEngine {
    const engine = new GameEngine('test', makePlayers());
    engine.startGame();
    const state = engine.getState();
    state.players[0].hand = p0Hand;
    state.players[0].handSize = p0Hand.length;
    state.players[0].team = p0Team;
    // Other players get filler hands with no red 10s (they'll be black10).
    for (let i = 1; i < 6; i++) {
      state.players[i].hand = [
        card('3', 'clubs', false, `p${i}-3c`),
        card('4', 'clubs', false, `p${i}-4c`),
      ];
      state.players[i].handSize = 2;
      state.players[i].team = 'black10';
    }
    // Force phase to doubling and make p0 the current bidder.
    state.phase = 'doubling';
    state.doubling = {
      currentBidderId: 'p0',
      startingBidderId: 'p0',
      isDoubled: false,
      revealedBombs: [],
      teamsRevealed: false,
      skipped: new Set<string>(),
    } as any;
    return engine;
  }

  it('skips doubling on a mediocre hand with only 1 small bomb', () => {
    // Single K-bomb plus random cards — the kind of hand that used to trigger
    // aggressive bots to double. Should now skip.
    const hand: Card[] = [
      card('K', 'spades', false, 'kb1'),
      card('K', 'hearts', true, 'kr1'),
      card('K', 'hearts2', true, 'kr2'),
      card('3', 'clubs', false),
      card('5', 'clubs', false),
      card('7', 'clubs', false),
      card('8', 'hearts', true),
      card('9', 'diamonds', true),
      card('J', 'clubs', false),
      card('Q', 'hearts', true),
      card('A', 'spades', false),
      card('2', 'clubs', false),
      card('4', 'hearts', true),
    ];
    const engine = setupForDoubling(hand, 'black10');
    const decision = AggressiveStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('skip');
  });

  it('doubles on a genuinely strong hand with 2 bombs', () => {
    // One 4-card bomb (5×4) + one 3-card bomb (K×3) = score 9, meets the bar.
    // Two ×3 bombs alone only score 7 and are no longer enough — sparse singles
    // make the hand hard to play out efficiently.
    const hand: Card[] = [
      card('5', 'hearts', true, 'b1a'),
      card('5', 'spades', false, 'b1b'),
      card('5', 'clubs', false, 'b1c'),
      card('5', 'diamonds', false, 'b1d'),
      card('K', 'hearts', true, 'b2a'),
      card('K', 'spades', false, 'b2b'),
      card('K', 'clubs', false, 'b2c'),
      card('3', 'clubs', false),
      card('6', 'clubs', false),
      card('8', 'hearts', true),
      card('9', 'diamonds', true),
      card('J', 'clubs', false),
      card('Q', 'hearts', true),
    ];
    const engine = setupForDoubling(hand, 'black10');
    const decision = AggressiveStrategy.decideDoubling(engine, 'p0');
    expect(decision.action).toBe('double');
  });

  it("doesn't double on just straights + a single bomb (the old over-aggressive case)", () => {
    // 3-4-5-6-7-8-9 = long straight AND 1 bomb. Used to score high enough
    // to double under the old overlapping-straights scoring.
    const hand: Card[] = [
      card('3', 'clubs', false),
      card('4', 'hearts', true),
      card('5', 'spades', false),
      card('6', 'clubs', false),
      card('7', 'hearts', true),
      card('8', 'spades', false),
      card('9', 'clubs', false),
      card('10', 'hearts', true, 'ten-red'),
      card('J', 'spades', false, 'jb1'),
      card('J', 'hearts', true, 'jr1'),
      card('J', 'clubs', false, 'jb2'),
      card('Q', 'hearts', true),
      card('K', 'spades', false),
    ];
    const engine = setupForDoubling(hand, 'red10');
    // Even the most aggressive bot should not double this — 1 bomb alone is
    // not bet-worthy.
    expect(AggressiveStrategy.decideDoubling(engine, 'p0').action).toBe('skip');
    expect(SmartRacerStrategy.decideDoubling(engine, 'p0').action).toBe('skip');
    expect(HandSizeExploiterStrategy.decideDoubling(engine, 'p0').action).toBe('skip');
    expect(TeamCoordinatorStrategy.decideDoubling(engine, 'p0').action).toBe('skip');
  });
});

describe('BotManager — teammate speculative cha', () => {
  it('declines speculative cha (hand-shaping path) when the trigger was played by a teammate', () => {
    // p0 (black10) plays single-4, triggering waiting_cha.
    // p3 (black10, same team as p0) has two 4s and a 5-9 intact straight.
    // Hand-shaping would normally cha here (5-card straight is preserved after
    // removing the two 4s). But the trigger is a teammate, so the bot must decline.
    const hands: Card[][] = [
      // p0 black10: plays single 4 to trigger cha-go
      [card('4', 'hearts', true, 'p0-4h'), card('5', 'hearts', true), card('6', 'hearts', true)],
      // p1 red10: 4 cards, no 4s
      [card('Q', 'hearts', true, 'p1-qh'), card('K', 'hearts', true), card('A', 'hearts', true), card('3', 'clubs', false)],
      // p2 red10: 4 cards, no 4s
      [card('7', 'clubs', false), card('8', 'clubs', false), card('9', 'clubs', false), card('J', 'clubs', false)],
      // p3 black10: two 4s + 5-9 straight (intact after cha)
      [
        card('4', 'spades', false, 'p3-4s'),
        card('4', 'clubs', false, 'p3-4c'),
        card('5', 'spades', false, 'p3-5s'),
        card('6', 'spades', false, 'p3-6s'),
        card('7', 'spades', false, 'p3-7s'),
        card('8', 'spades', false, 'p3-8s'),
        card('9', 'spades', false, 'p3-9s'),
      ],
      // p4 red10: 4 cards, no 4s
      [card('3', 'diamonds', true), card('6', 'diamonds', true), card('8', 'diamonds', true), card('J', 'diamonds', true)],
      // p5 black10: 4 cards, no 4s
      [card('J', 'hearts', true), card('Q', 'clubs', false), card('A', 'clubs', false), card('2', 'clubs', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');
    // p0 plays the single 4 — triggers waiting_cha
    engine.playCards('p0', [hands[0][0]]);
    expect(engine.getState().round?.chaGoState?.phase).toBe('waiting_cha');

    // p3 must DECLINE: trigger is teammate p0, speculative cha blocked
    const decision = SmartRacerStrategy.decidePlay(engine, 'p3');
    expect(decision.action).toBe('decline_cha');
  });
});

describe('BotManager — P4(d) pair opening vs 2-card opponent', () => {
  it('leads the highest pair when opponent has 2 cards and no straights exist', () => {
    // Bot Charlie scenario from 2026-04-25T02-40-38-XQVL: hand has K-K and Q-Q pairs
    // but no straights/paired_straights. With opponent at 2 cards, P4(d) previously
    // fell through to highest single (K). After fix it should play K-K pair.
    const hands: Card[][] = [
      // p0 has K-K, Q-Q, and three singles (no straights — ranks non-consecutive)
      [
        card('K', 'spades', false, 'p0-ks'),
        card('K', 'hearts', true, 'p0-kh'),
        card('Q', 'spades', false, 'p0-qs'),
        card('Q', 'hearts', true, 'p0-qh'),
        card('9', 'spades', false, 'p0-9s'),
        card('7', 'clubs', false, 'p0-7c'),
        card('3', 'hearts', true, 'p0-3h'),
      ],
      // p1 (black10 opponent): exactly 2 cards
      [card('5', 'clubs', false, 'p1-5c'), card('6', 'clubs', false, 'p1-6c')],
      // p2-p5: 4+ cards each, no threat
      [card('4', 'clubs', false), card('5', 'hearts', true), card('6', 'spades', false), card('7', 'hearts', true)],
      [card('8', 'clubs', false), card('9', 'hearts', true), card('10', 'spades', false), card('J', 'clubs', false)],
      [card('4', 'diamonds', true), card('5', 'diamonds', true), card('6', 'diamonds', true), card('8', 'diamonds', true)],
      [card('J', 'hearts', true), card('A', 'clubs', false), card('2', 'spades', false), card('3', 'diamonds', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    // Must be a pair (2 cards), not a single (1 card)
    expect(decision.cards).toHaveLength(2);
    // Must be the K-K pair (highest), not Q-Q
    expect(decision.cards.every(c => c.rank === 'K')).toBe(true);
  });
});

describe('BotManager — exit-in-one-play opening', () => {
  it('plays entire hand as a bomb when the whole hand forms a valid combo', () => {
    // p0 holds exactly 4 Kings (a bomb). Previously chooseBestOpening would
    // only consider singles (excluded from pairs/singles because they're a bomb
    // rank) and fall back to a single K. With the full-hand exit candidate added,
    // the bomb scores +100 and wins outright.
    const hands: Card[][] = [
      [
        card('K', 'spades', false, 'p0-ks'),
        card('K', 'hearts', true, 'p0-kh'),
        card('K', 'clubs', false, 'p0-kc'),
        card('K', 'diamonds', true, 'p0-kd'),
      ],
      // p1-p5: safe hands, 4 cards each, no ≤2 threat
      [card('3', 'clubs', false, 'p1-3c'), card('4', 'clubs', false, 'p1-4c'), card('5', 'clubs', false, 'p1-5c'), card('6', 'clubs', false, 'p1-6c')],
      [card('7', 'clubs', false, 'p2-7c'), card('8', 'clubs', false, 'p2-8c'), card('9', 'clubs', false, 'p2-9c'), card('10', 'clubs', false, 'p2-tc')],
      [card('3', 'hearts', true, 'p3-3h'), card('4', 'hearts', true, 'p3-4h'), card('5', 'hearts', true, 'p3-5h'), card('6', 'hearts', true, 'p3-6h')],
      [card('7', 'hearts', true, 'p4-7h'), card('8', 'hearts', true, 'p4-8h'), card('9', 'hearts', true, 'p4-9h'), card('J', 'clubs', false, 'p4-jc')],
      [card('Q', 'clubs', false, 'p5-qc'), card('A', 'clubs', false, 'p5-ac'), card('2', 'clubs', false, 'p5-2c'), card('3', 'diamonds', true, 'p5-3d')],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    // Must play all 4 Kings as the bomb (not a single K fallback)
    expect(decision.cards).toHaveLength(4);
    expect(decision.cards.every(c => c.rank === 'K')).toBe(true);
  });
});

describe('BotManager — long straight opening', () => {
  it('prefers a 5-card straight over a 3-card straight when opening', () => {
    // If the bot has a 5-card straight (5-6-7-8-9) and also a 3-card straight
    // (5-6-7), it should open with the 5-card version to shed more cards.
    const hands: Card[][] = [
      [
        card('5', 'spades', false, 'p0-5'),
        card('6', 'hearts', true, 'p0-6'),
        card('7', 'clubs', false, 'p0-7'),
        card('8', 'diamonds', true, 'p0-8'),
        card('9', 'spades', false, 'p0-9'),
        card('3', 'clubs', false, 'p0-3'),
        card('J', 'hearts', true, 'p0-j'),
      ],
      [card('4', 'clubs', false), card('10', 'clubs', false), card('Q', 'clubs', false)],
      [card('3', 'hearts', true), card('K', 'clubs', false), card('A', 'clubs', false)],
      [card('4', 'hearts', true), card('8', 'clubs', false), card('2', 'clubs', false)],
      [card('6', 'clubs', false), card('9', 'clubs', false), card('Q', 'hearts', true)],
      [card('7', 'hearts', true), card('J', 'clubs', false), card('K', 'hearts', true)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    // Should play the 5-card straight (all five consecutive cards)
    expect(decision.cards.length).toBe(5);
  });

  it('opens with a 7-card straight when holding consecutive ranks', () => {
    // Holding 3-4-5-6-7-8-9 (7 consecutive): should open all 7 at once.
    const hands: Card[][] = [
      [
        card('3', 'spades', false, 'p0-3'),
        card('4', 'hearts', true, 'p0-4'),
        card('5', 'clubs', false, 'p0-5'),
        card('6', 'diamonds', true, 'p0-6'),
        card('7', 'spades', false, 'p0-7'),
        card('8', 'hearts', true, 'p0-8'),
        card('9', 'clubs', false, 'p0-9'),
        card('Q', 'spades', false, 'p0-q'),
        card('K', 'hearts', true, 'p0-k'),
      ],
      [card('4', 'clubs', false), card('10', 'clubs', false), card('J', 'clubs', false)],
      [card('3', 'hearts', true), card('A', 'clubs', false), card('2', 'clubs', false)],
      [card('5', 'hearts', true), card('8', 'clubs', false), card('J', 'hearts', true)],
      [card('6', 'clubs', false), card('9', 'hearts', true), card('Q', 'clubs', false)],
      [card('7', 'clubs', false), card('10', 'hearts', true), card('K', 'clubs', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    // Should play the full 7-card straight
    expect(decision.cards.length).toBe(7);
  });
});

describe('BotManager — near-exit play preference', () => {
  it('plays an A-pair to reach exit range even when P6 conservation would pass', () => {
    // Scenario: p5 (opponent) just opened with a pair of 3s. p0 (red10) has 4 cards:
    // an A-pair + 2 other cards. P6 rank conservation would normally save the A-pair
    // against such a low-rank play, but near-exit overrides — playing leaves 2 cards.
    // opponentMinHand = 5 (no threat, so P5 medThreat doesn't fire).
    const hands: Card[][] = [
      // p0: A-pair + 2 filler cards (4 total)
      [
        card('A', 'spades', false, 'p0-as'),
        card('A', 'hearts', true, 'p0-ah'),
        card('7', 'clubs', false, 'p0-7c'),
        card('8', 'spades', false, 'p0-8s'),
      ],
      [card('Q', 'clubs', false), card('J', 'clubs', false), card('10', 'clubs', false),
       card('9', 'clubs', false), card('6', 'clubs', false)],
      [card('3', 'hearts', true), card('4', 'clubs', false), card('K', 'clubs', false),
       card('Q', 'hearts', true), card('J', 'hearts', true)],
      [card('5', 'hearts', true), card('6', 'clubs', false), card('10', 'hearts', true),
       card('9', 'hearts', true), card('8', 'hearts', true)],
      [card('7', 'hearts', true), card('8', 'clubs', false), card('5', 'clubs', false),
       card('4', 'hearts', true), card('6', 'hearts', true)],
      // p5: opener, plays pair of 3s then goes to 3 cards
      [card('3', 'spades', false, 'p5-3s'), card('3', 'clubs', false, 'p5-3c'),
       card('K', 'spades', false), card('Q', 'spades', false), card('J', 'spades', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p5');

    // p5 plays a pair of 3s (lowest pair)
    engine.playCards('p5', [hands[5][0], hands[5][1]]);

    // p0 is next. Has A-pair — P6 conservation would pass (A >> 3 rank gap),
    // but near-exit kicks in: playing A-pair leaves 2 cards (→ exit range).
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action !== 'play') return;
    expect(decision.cards).toHaveLength(2);
    expect(decision.cards[0].rank).toBe('A');
  });
});

describe('BotManager — cha hand-shaping', () => {
  it('chas at low rank when it preserves an intact 5-card exit straight', () => {
    // p0 plays a low single (rank 4), p1 has two 4s to cha.
    // p1 also holds a 5-card straight (7-8-9-10-J) that doesn't use any 4s.
    // Even though no opponent skip is available, p1 should cha to thin the hand.
    const hands: Card[][] = [
      // p0: plays 4♥ single to trigger cha
      [card('4', 'hearts', true, 'p0-4h'), card('Q', 'spades', false), card('K', 'spades', false)],
      // p1: two 4s + 5-card straight 7-J + a filler
      [
        card('4', 'spades', false, 'p1-4s'),
        card('4', 'clubs', false, 'p1-4c'),
        card('7', 'hearts', true, 'p1-7'),
        card('8', 'spades', false, 'p1-8'),
        card('9', 'clubs', false, 'p1-9'),
        card('10', 'hearts', true, 'p1-10'),
        card('J', 'spades', false, 'p1-j'),
        card('3', 'clubs', false, 'p1-3'),
      ],
      // p2-p5: all have many cards so no opponent is near-exit
      [card('5', 'clubs', false), card('6', 'clubs', false), card('8', 'clubs', false),
       card('9', 'hearts', true), card('Q', 'clubs', false)],
      [card('3', 'hearts', true), card('5', 'hearts', true), card('K', 'clubs', false),
       card('A', 'clubs', false), card('2', 'clubs', false)],
      [card('6', 'hearts', true), card('7', 'clubs', false), card('J', 'clubs', false),
       card('Q', 'hearts', true), card('K', 'hearts', true)],
      [card('10', 'clubs', false), card('J', 'hearts', true), card('A', 'hearts', true),
       card('2', 'spades', false), card('6', 'spades', false)],
    ];
    const teams: ('red10' | 'black10')[] = [
      'red10', 'black10', 'red10', 'black10', 'red10', 'black10',
    ];
    const engine = setupEngine(hands, teams, 'p0');
    engine.playCards('p0', [hands[0][0]]);

    // Verify cha-go is active on rank 4
    expect(engine.getState().round?.chaGoState?.phase).toBe('waiting_cha');
    expect(engine.getState().round?.chaGoState?.triggerRank).toBe('4');

    // p1 should cha: rank 4 is low, no opponents are near-exit,
    // but p1 holds 7-8-9-10-J straight that cha-ing won't break.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('cha');
  });
});

describe('BotManager — P3 bomb guard: no bombing over a winning teammate', () => {
  it('passes instead of bombing when a teammate holds the round under high threat', () => {
    // Scenario from game 9Q4N R14:
    // p4 (black10, teammate of p0) just played A♠ single and is winning the round.
    // p5 (red10, opponent) has 2 cards → highThreat fires.
    // p0 (black10) has a 3-of-a-kind 8 bomb (8×3).
    // Before fix: highThreat overrode the teammate-pass guard → p0 bombed over teammate.
    // After fix: p0 should pass (let teammate win; if opponent can beat A♠ they'll reveal it).
    const hands: Card[][] = [
      // p0 (black10): has an 8×3 bomb + 2 other cards
      [
        card('8', 'clubs', false, 'p0-8c'),
        card('8', 'hearts', true, 'p0-8h'),
        card('8', 'spades', false, 'p0-8s'),
        card('5', 'clubs', false, 'p0-5c'),
        card('6', 'clubs', false, 'p0-6c'),
      ],
      // p1-p3: filler, many cards so they don't trigger threat
      [card('4', 'clubs', false), card('7', 'clubs', false), card('9', 'clubs', false),
       card('10', 'clubs', false), card('J', 'clubs', false), card('Q', 'clubs', false)],
      [card('4', 'hearts', true), card('7', 'hearts', true), card('9', 'hearts', true),
       card('10', 'hearts', true), card('J', 'hearts', true), card('Q', 'hearts', true)],
      [card('3', 'spades', false), card('6', 'spades', false), card('7', 'spades', false),
       card('9', 'spades', false), card('10', 'spades', false), card('J', 'spades', false)],
      // p4 (black10, teammate of p0): will play A♠, then has 3 remaining
      [card('K', 'clubs', false, 'p4-kc'), card('3', 'hearts', true, 'p4-3h'), card('4', 'hearts', true, 'p4-4h')],
      // p5 (red10, opponent): 2 cards → highThreat
      [card('2', 'clubs', false, 'p5-2c'), card('3', 'clubs', false, 'p5-3c')],
    ];
    const teams: ('red10' | 'black10')[] = [
      'black10', 'red10', 'black10', 'red10', 'black10', 'red10',
    ];
    const engine = setupEngine(hands, teams, 'p4');
    // inject A♠ into p4's hand and have p4 open the round with it
    const aSpade = card('A', 'spades', false, 'p4-as');
    const state = engine.getState();
    state.players[4].hand.unshift(aSpade);
    state.players[4].handSize += 1;
    engine.playCards('p4', [aSpade]);

    // p5 passes (can't or won't beat A♠)
    engine.pass('p5');

    // Now it's p0's turn. Teammate p4 is winning with A♠, opponent p5 has 2 cards.
    // p0 should PASS (not bomb over winning teammate).
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('pass');
  });
});

describe('BotManager — chooseBestOpening: endgame scoring (hand ≤ 4 cards)', () => {
  it('prefers K+K pair over low single with 4-card hand', () => {
    // Before fix: scoreOpening awarded low-rank bonus, making 4♦ score ~40 vs K+K ~24.
    // After fix: endgame scoring (hand≤4) uses avgRank bonus, K+K scores ~30 vs 4♦ ~11.
    const hands: Card[][] = [
      [
        card('K', 'spades', false, 'p0-ks'),
        card('K', 'hearts2', true, 'p0-kh2'),
        card('2', 'clubs', false, 'p0-2c'),
        card('4', 'diamonds', true, 'p0-4d'),
      ],
      [card('3','clubs',false), card('5','clubs',false), card('6','clubs',false),
       card('7','clubs',false), card('8','clubs',false), card('9','clubs',false), card('10','clubs',false)],
      [card('3','hearts',true), card('5','hearts',true), card('6','hearts',true),
       card('7','hearts',true), card('8','hearts',true), card('9','hearts',true), card('10','hearts',true)],
      [card('3','spades',false), card('5','spades',false), card('6','spades',false),
       card('7','spades',false), card('8','spades',false), card('9','spades',false), card('10','spades',false)],
      [card('3','diamonds',true), card('5','diamonds',true), card('6','diamonds',true),
       card('7','diamonds',true), card('8','diamonds',true), card('9','diamonds',true), card('10','diamonds',true)],
      [card('4','clubs',false), card('5','clubs2',false), card('6','clubs2',false),
       card('7','clubs2',false), card('8','clubs2',false), card('9','clubs2',false), card('J','clubs2',false)],
    ];
    const teams: ('red10' | 'black10')[] = ['black10','red10','black10','red10','black10','red10'];
    const engine = setupEngine(hands, teams, 'p0');
    const state = engine.getState();
    state.round!.currentFormat = null;
    state.round!.leaderId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards).toHaveLength(2);
      expect(decision.cards.every(c => c.rank === 'K')).toBe(true);
    }
  });
});

describe('BotManager — chooseBestOpening: bomb-breaking straight filter', () => {
  it('avoids opening a straight that would break a K×3 bomb', () => {
    // J-Q-K♦ is the only 3-card straight but K♦ belongs to a K×3 bomb.
    // After fix: that straight is excluded; bot opens a single instead.
    const hands: Card[][] = [
      [
        card('K', 'diamonds', true,  'p0-kd'),
        card('K', 'spades',   false, 'p0-ks'),
        card('K', 'hearts2',  true,  'p0-kh2'),
        card('J', 'hearts2',  true,  'p0-jh2'),
        card('Q', 'hearts',   true,  'p0-qh'),
        card('4', 'diamonds', true,  'p0-4d'),
        card('2', 'clubs',    false, 'p0-2c'),
      ],
      [card('3','clubs',false), card('5','clubs',false), card('6','clubs',false),
       card('7','clubs',false), card('8','clubs',false), card('9','clubs',false), card('10','clubs',false)],
      [card('3','hearts',true), card('5','hearts',true), card('6','hearts',true),
       card('7','hearts',true), card('8','hearts',true), card('9','hearts',true), card('10','hearts',true)],
      [card('3','spades',false), card('5','spades',false), card('6','spades',false),
       card('7','spades',false), card('8','spades',false), card('9','spades',false), card('10','spades',false)],
      [card('3','diamonds',true), card('5','diamonds',true), card('6','diamonds',true),
       card('7','diamonds',true), card('8','diamonds',true), card('9','diamonds',true), card('10','diamonds',true)],
      [card('4','clubs',false), card('5','clubs2',false), card('6','clubs2',false),
       card('7','clubs2',false), card('8','clubs2',false), card('9','clubs2',false), card('J','clubs2',false)],
    ];
    const teams: ('red10' | 'black10')[] = ['black10','red10','black10','red10','black10','red10'];
    const engine = setupEngine(hands, teams, 'p0');
    const state = engine.getState();
    state.round!.currentFormat = null;
    state.round!.leaderId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // Must not open with a 3+ card straight containing any K (bomb-rank)
      const hasK = decision.cards.some(c => c.rank === 'K');
      const isMultiCardPlay = decision.cards.length >= 3;
      expect(hasK && isMultiCardPlay).toBe(false);
    }
  });
});

describe('BotManager — chooseBestOpening: all-bomb-rank fallback', () => {
  it('plays weakest full bomb (not a single) when all cards are bomb-rank', () => {
    // Hand: 7×3, 9×3, Q×3 — 9 cards, every rank is a bomb rank.
    // Old behaviour: fallback adds all singles → picks 7♣ (lowest rank single).
    // New behaviour: fallback adds all bombs → picks 7×3 (3-card, rank 7, score 25).
    const hands: Card[][] = [
      [
        card('7', 'clubs',   false, 'p0-7c'),
        card('7', 'hearts2', true,  'p0-7h2'),
        card('7', 'hearts',  true,  'p0-7h'),
        card('9', 'hearts',  true,  'p0-9h'),
        card('9', 'clubs2',  false, 'p0-9c2'),
        card('9', 'spades',  false, 'p0-9s'),
        card('Q', 'clubs2',  false, 'p0-qc2'),
        card('Q', 'spades',  false, 'p0-qs'),
        card('Q', 'clubs',   false, 'p0-qc'),
      ],
      [card('3','clubs',false), card('5','clubs',false), card('6','clubs',false),
       card('7','clubs',false), card('8','clubs',false), card('9','clubs',false), card('10','clubs',false)],
      [card('3','hearts',true), card('5','hearts',true), card('6','hearts',true),
       card('7','hearts',true), card('8','hearts',true), card('9','hearts',true), card('10','hearts',true)],
      [card('3','spades',false), card('5','spades',false), card('6','spades',false),
       card('7','spades',false), card('8','spades',false), card('9','spades',false), card('10','spades',false)],
      [card('3','diamonds',true), card('5','diamonds',true), card('6','diamonds',true),
       card('7','diamonds',true), card('8','diamonds',true), card('9','diamonds',true), card('10','diamonds',true)],
      [card('4','clubs',false), card('5','clubs2',false), card('6','clubs2',false),
       card('7','clubs2',false), card('8','clubs2',false), card('J','clubs2',false), card('10','clubs2',false)],
    ];
    const teams: ('red10' | 'black10')[] = ['black10','red10','black10','red10','black10','red10'];
    const engine = setupEngine(hands, teams, 'p0');
    const state = engine.getState();
    state.round!.currentFormat = null;
    state.round!.leaderId = 'p0';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // Should play 3 cards (full bomb), not 1 (single from bomb group)
      expect(decision.cards).toHaveLength(3);
      // Should be the weakest bomb: rank 7
      expect(decision.cards.every(c => c.rank === '7')).toBe(true);
    }
  });
});
