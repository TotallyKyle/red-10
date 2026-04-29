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
    { id: 'p4', name: 'Kyle', seatIndex: 4 },
    { id: 'p5', name: 'Eve', seatIndex: 5 },
  ];
}

// ---- Test 1: DMQS R5 — Alice does NOT play Red10×2 at hand size 7 ----

describe('DMQS R5 — Red10×2 reluctance at hand size 7', () => {
  it('Alice responds to 2-pair with pass, not Red10×2, when hand size is 7', () => {
    // Reproduction of DMQS R5: Alice (p0, red10 team) has 7 cards including
    // two red 10s. Bob (p2) leads a 2♦2♣ pair. Kyle (p4) has 1 card — high
    // threat. Without Fix A, findBeatingPlays returns Red10×2 as the only
    // beating play for a pair lead, and the bot plays it. With Fix A,
    // Red10×2 is filtered out when handSize > 4, bp becomes empty, and the
    // bot correctly falls through to pass.

    const aliceHand: Card[] = [
      card('5', 'hearts', true, 'a-5h'),
      card('7', 'hearts', true, 'a-7h'),
      card('10', 'diamonds', true, 'a-10d'),  // red 10
      card('10', 'hearts', true, 'a-10h'),    // red 10
      card('J', 'clubs', false, 'a-Jc'),
      card('K', 'hearts', true, 'a-Kh'),
      card('K', 'clubs', false, 'a-Kc'),
    ];

    // Dummy hands for other players — filler so the engine is valid
    const filler: Card[] = [
      card('3', 'spades', false, 'f0-3s'),
      card('4', 'spades', false, 'f0-4s'),
      card('8', 'spades', false, 'f0-8s'),
      card('9', 'spades', false, 'f0-9s'),
    ];

    const engine = new GameEngine('dmqs-r5-test', makePlayers());
    engine.startGame();

    const state = engine.getState();

    // p0 = Alice (red10, 7 cards)
    state.players[0].hand = aliceHand;
    state.players[0].handSize = 7;
    state.players[0].team = 'red10';

    // p1-p3: black10 opponents with filler hands
    for (let i = 1; i <= 3; i++) {
      state.players[i].hand = [...filler.map(c => ({ ...c, id: `f${i}-${c.id}` }))];
      state.players[i].handSize = filler.length;
      state.players[i].team = 'black10';
    }

    // p4 = Kyle: opponent with 1 card — creates highThreat condition
    state.players[4].hand = [card('Q', 'spades', false, 'k-Qs')];
    state.players[4].handSize = 1;
    state.players[4].team = 'black10';

    // p5 = Eve: teammate
    state.players[5].hand = [...filler.map(c => ({ ...c, id: `fe-${c.id}` }))];
    state.players[5].handSize = filler.length;
    state.players[5].team = 'red10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p0');

    // Inject a 2-pair lastPlay from p2 (Charlie/Bob's position)
    // so Alice is now in the responding path
    state.round!.lastPlay = {
      playerId: 'p2',
      cards: [
        card('2', 'diamonds', true, 'b-2d'),
        card('2', 'clubs', false, 'b-2c'),
      ],
      format: 'pair',
      rankValue: 12,
      length: 2,
      timestamp: Date.now(),
    };
    state.round!.currentFormat = 'pair';

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');

    // Without Fix A, the bot plays Red10×2 here (it's the only beating play
    // for a 2-pair when Alice holds two red 10s). Fix A filters Red10×2 out
    // when handSize > 4, so bp becomes empty and the bot passes.
    expect(decision.action).toBe('pass');
  });
});

// ---- Test 2: DMQS R2 — Eve does NOT cha with 3-3 pair when 3 copies remain ----

describe('DMQS R2 — speculative cha declined when 3+ copies remain', () => {
  it('Eve (p5) declines cha with 3♣3♣ when afterChaRemaining=3 (deterministic with Fix B)', () => {
    // Reproduction of DMQS R2: Kyle (p4) plays 3♦ single. Eve (p5) holds
    // 3♣3♣ (the pair). Known copies: Kyle's 3♦ (played) + Eve's 3♣3♣ (hand)
    // = 3 of 6. estimatePlayedCopies sums played-this-round (1) + in-hand (2)
    // = 3, so afterChaRemaining = 6 - 3 = 3.
    //
    // Without Fix B, the "hand >= 8 → 30% cha" branch would fire for Eve's
    // 13-card hand, causing a random 30% cha rate. With Fix B that path is
    // removed: afterChaRemaining=3 hits neither the ===1 nor ===2 branch,
    // falls through to return 'decline' — deterministic.

    const kyleHand: Card[] = [
      card('3', 'diamonds', true, 'k-3d'),  // will be played as the trigger
      card('5', 'clubs', false, 'k-5c'),
      card('7', 'hearts', true, 'k-7h'),
    ];

    // Eve's actual DMQS R2 starting hand: 13 cards including two 3♣s and
    // an 8-9-10-J-Q-K run (6-card intact straight). The straight matters:
    // before this fix, the hand-shaping cha path (`5+ intact straight that
    // cha doesn't break`) would fire BEFORE the copy-count check and return
    // 'cha' even with 3 copies remaining. The hand-size gate (hand ≤ 9) on
    // the hand-shaping path now correctly excludes Eve's 13-card situation,
    // letting the copy-count guard catch it.
    const eveHand: Card[] = [
      card('3', 'clubs', false, 'e-3c1'),
      card('3', 'clubs', false, 'e-3c2'),
      card('4', 'hearts', true, 'e-4h'),
      card('4', 'diamonds', true, 'e-4d'),
      card('5', 'spades', false, 'e-5s'),
      card('8', 'clubs', false, 'e-8c'),
      card('9', 'hearts', true, 'e-9h'),
      card('9', 'clubs', false, 'e-9c'),
      card('10', 'hearts', true, 'e-10h'),
      card('J', 'diamonds', true, 'e-Jd'),
      card('Q', 'clubs', false, 'e-Qc'),
      card('K', 'hearts', true, 'e-Kh'),
      card('2', 'spades', false, 'e-2s'),
    ];

    const filler: Card[] = [
      card('6', 'spades', false, 'fx-6s'),
      card('7', 'spades', false, 'fx-7s'),
      card('8', 'spades', false, 'fx-8s'),
      card('J', 'spades', false, 'fx-Js'),
    ];

    const engine = new GameEngine('dmqs-r2-test', makePlayers());
    engine.startGame();

    const state = engine.getState();

    // p0-p3: opponents/teammates with filler (black10)
    for (let i = 0; i <= 3; i++) {
      state.players[i].hand = [...filler.map(c => ({ ...c, id: `f${i}-${c.id}` }))];
      state.players[i].handSize = filler.length;
      state.players[i].team = 'black10';
    }

    // p4 = Kyle: will lead 3♦ single to trigger cha-go
    state.players[4].hand = kyleHand;
    state.players[4].handSize = kyleHand.length;
    state.players[4].team = 'black10';

    // p5 = Eve: has the matching 3♣3♣ pair, 13 cards
    state.players[5].hand = eveHand;
    state.players[5].handSize = eveHand.length;
    state.players[5].team = 'red10';

    state.phase = 'playing';
    state.doubling = null;
    engine.startNewRound('p4');  // Kyle leads

    // Kyle plays 3♦ single — engine automatically sets up chaGoState with Eve eligible
    const playResult = engine.playCards('p4', [kyleHand[0]]);
    expect(playResult.success).toBe(true);

    const roundState = engine.getState().round;
    expect(roundState?.chaGoState).not.toBeNull();
    expect(roundState?.chaGoState?.phase).toBe('waiting_cha');
    expect(roundState?.chaGoState?.eligiblePlayerIds).toContain('p5');
    expect(roundState?.chaGoState?.triggerRank).toBe('3');

    // afterChaRemaining = 6 - (1 played this round + 2 in Eve's hand) = 3.
    // Two layers of defense in the fix:
    //   (1) hand-shaping path now requires hand ≤ 9 — Eve's 13 fails the gate
    //       so the 8-9-10-J-Q-K straight no longer triggers an early cha return.
    //   (2) copy-count branches only fire at remaining ≤ 2 — falls through to
    //       deterministic decline at remaining = 3.
    // Pre-fix: hand-shaping path returned 'cha' immediately on the intact straight.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p5');
    expect(decision.action).toBe('decline_cha');
  });
});
