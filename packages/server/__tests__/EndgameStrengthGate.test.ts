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
 * Build an engine in the OPENING position for p0 (the bot being tested).
 * Other players get filler hands of `fillerSize` cards to avoid triggering
 * branches (c)/(d) (opponentMinHand ≤ 1 or ≤ 2).
 */
function setupOpeningEngine(p0Hand: Card[], fillerSize = 5): GameEngine {
  const engine = new GameEngine('endgame-strength-gate-test', makePlayers());
  engine.startGame();

  const state = engine.getState();

  state.players[0].hand = p0Hand;
  state.players[0].handSize = p0Hand.length;
  state.players[0].team = 'black10';

  // Filler: use unique IDs per player to avoid card-ID collisions.
  for (let i = 1; i < 6; i++) {
    const filler: Card[] = Array.from({ length: fillerSize }, (_, j) =>
      card('3', 'clubs', false, `filler-p${i}-${j}`),
    );
    state.players[i].hand = filler;
    state.players[i].handSize = fillerSize;
    state.players[i].team = i % 2 === 0 ? 'black10' : 'red10';
  }

  state.phase = 'playing';
  state.doubling = null;
  engine.startNewRound('p0');

  return engine;
}

/**
 * Build an engine where p0 (opponent, black10) has already led `leaderCard`,
 * and p1 (bot, red10) is next to respond.
 * All other players get filler hands of `fillerSize` cards.
 */
function setupRespondingEngine(opts: {
  botHand: Card[];
  leaderCard: Card;
  fillerSize?: number;
}): GameEngine {
  const { botHand, leaderCard, fillerSize = 5 } = opts;

  const engine = new GameEngine('endgame-responding-test', makePlayers());
  engine.startGame();

  const state = engine.getState();

  // p0 = opponent leader (black10)
  state.players[0].hand = [leaderCard, ...Array.from({ length: fillerSize }, (_, j) =>
    card('8', 'spades', false, `p0fill-${j}`),
  )];
  state.players[0].handSize = state.players[0].hand.length;
  state.players[0].team = 'black10';

  // p1 = bot (red10)
  state.players[1].hand = botHand;
  state.players[1].handSize = botHand.length;
  state.players[1].team = 'red10';

  // Other players: fillerSize-card filler hands, alternating teams
  for (let i = 2; i < 6; i++) {
    const filler: Card[] = Array.from({ length: fillerSize }, (_, j) =>
      card('3', 'clubs', false, `filler-p${i}-${j}`),
    );
    state.players[i].hand = filler;
    state.players[i].handSize = fillerSize;
    state.players[i].team = i % 2 === 0 ? 'black10' : 'red10';
  }

  state.phase = 'playing';
  state.doubling = null;
  engine.startNewRound('p0');

  const result = engine.playCards('p0', [leaderCard]);
  if (!result.success) throw new Error(`Setup play failed: ${result.error}`);

  return engine;
}

describe('EndgameStrengthGate — scoreOpening dump-mode for weak hands', () => {
  /**
   * Test 1: Weak hand at endgame — dump mode fires, leads lowest orphan.
   *
   * Hand: [3♠, 6♠, 7♣, K♥] (4 cards, no pairs, no straights, no bombs).
   * isEndgame=true but NOT super-strong (no rank×3, no 4-pair+A).
   * Dump-mode scoring:
   *   3♠ single (orphan, rv=0): 10 + 8 + (12-0)*2 = 42
   *   6♠ single (orphan, rv=3): 10 + 8 + (12-3)*2 = 36
   *   7♣ single (orphan, rv=4): 10 + 8 + (12-4)*2 = 34
   *   K♥ single (orphan, rv=10): 10 + 8 + (12-10)*2 = 22
   * 3♠ wins → bot leads 3♠, not K♥.
   */
  it('Test 1: weak hand=4 leads lowest orphan (dump mode), not highest (race mode)', () => {
    const p0Hand: Card[] = [
      card('3', 'spades', false, 'p0-3s'),
      card('6', 'spades', false, 'p0-6s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    const engine = setupOpeningEngine(p0Hand);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('3');
    }
  });

  /**
   * Test 2: Super-strong hand via special bomb (4-pair + A) — race mode fires.
   *
   * Hand: [4♣, 4♠, A♣, K♥] (4 cards). isSuperStrong=true via special bomb
   * (isgFours.length≥2 && isgAces.length≥1). Race mode fires.
   *
   * chooseBestOpening candidate analysis:
   *   - bombRanks = {'4', 'A'} (via getBombRanks special-bomb detection).
   *   - 4-pair excluded (bomb-rank, length=2 < 5).
   *   - A-single excluded (bomb-rank).
   *   - 4-singles excluded (bomb-rank).
   *   - Only K♥ qualifies as a single candidate.
   *   - Full-hand exit: detectFormat([4,4,A,K]) = null (not a valid format).
   * → Only K♥ is a candidate. Bot must play K♥.
   */
  it('Test 2: super-strong endgame (special bomb) leads K♥ (only non-bomb candidate)', () => {
    const p0Hand: Card[] = [
      card('4', 'clubs', false, 'p0-4c'),
      card('4', 'spades', false, 'p0-4s'),
      card('A', 'clubs', false, 'p0-Ac'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    const engine = setupOpeningEngine(p0Hand);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // Only K♥ is a non-bomb-rank candidate. Bot plays it regardless of mode.
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('K');
    }
  });

  /**
   * Test 3: Weak hand=4 with one pair + 2 singles — dump mode prefers pair.
   *
   * Hand: [5♣, 5♠, 8♣, K♥]. No bombs. isSuperStrong=false.
   * Dump-mode scoring:
   *   5-pair (not orphan): 20 + 0 + (12-2)*2 = 40
   *   8♣ single (orphan): 10 + 8 + (12-5)*2 = 32
   *   K♥ single (orphan): 10 + 8 + (12-10)*2 = 22
   * 5-pair wins (40 > 32 > 22). Bot leads 5-pair.
   */
  it('Test 3: weak hand=4 pair+singles — dump mode prefers pair (40) over low orphan (32)', () => {
    const p0Hand: Card[] = [
      card('5', 'clubs', false, 'p0-5c'),
      card('5', 'spades', false, 'p0-5s'),
      card('8', 'clubs', false, 'p0-8c'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    const engine = setupOpeningEngine(p0Hand);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(2);
      expect(decision.cards.every(c => c.rank === '5')).toBe(true);
    }
  });

  /**
   * Test 4: hasStrandedLowCard fires for orphan rank 9 (rv=6, new threshold).
   *
   * Bot hand: [9♠, 5♣, 5♠, 5♥, 2♥, 2♦, J♣, Q♣]
   *   - 9♠: orphan single (rv=6 ≤ 6 → stranded under new threshold)
   *   - 5×3: bomb rank (hasExtraPower: 1 bomb rank)
   *   - 2×2: pair → hasExtraPower fires (≥2 twos)
   *   - J♣, Q♣: orphan singles (rv > 6, NOT stranded)
   * Opponent leads 6♣ (single, rv=3). Bot can beat with: 2♥, 2♦, J♣, Q♣, 5-bomb.
   * M-Stranded fires: hasStrandedLowCard(9♠ rv=6 ≤ 6) && hasExtraPower(2s≥2).
   * winningBeats: [2♥], [2♦], [5×3 bomb]. Prefers 2-single first.
   * Bot plays a 2-single or the 5-bomb (a winning beat).
   *
   * Negative control: LegacyPreFixesStrategy (disableEndgameStrengthGate=true)
   * has orphanRvThreshold=2. rv(9)=6 > 2 → hasStrandedLowCard=false.
   * M-Stranded does NOT fire. Bot plays a cheap non-bomb beat (J♣ or Q♣).
   */
  it('Test 4a: M-Stranded fires for orphan rank 9 (rv=6 ≤ new threshold=6)', () => {
    const botHand: Card[] = [
      card('9', 'spades', false, 'p1-9s'),
      card('5', 'clubs', false, 'p1-5c'),
      card('5', 'spades', false, 'p1-5s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('2', 'hearts', true, 'p1-2h'),
      card('2', 'diamonds', true, 'p1-2d'),
      card('J', 'clubs', false, 'p1-Jc'),
      card('Q', 'clubs', false, 'p1-Qc'),
    ];
    const leaderCard = card('6', 'clubs', false, 'p0-6c');
    const engine = setupRespondingEngine({ botHand, leaderCard });

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // M-Stranded fires: bot plays a winning beat (2-single or 5-bomb)
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const is2Single = decision.cards.length === 1 && decision.cards[0].rank === '2';
      const isBomb = decision.cards.length >= 3;
      expect(is2Single || isBomb).toBe(true);
    }
  });

  it('Test 4b: M-Stranded does NOT fire for orphan rank 9 under legacy threshold (rv≤2)', () => {
    const botHand: Card[] = [
      card('9', 'spades', false, 'p1-9s'),
      card('5', 'clubs', false, 'p1-5c'),
      card('5', 'spades', false, 'p1-5s'),
      card('5', 'hearts', true, 'p1-5h'),
      card('2', 'hearts', true, 'p1-2h'),
      card('2', 'diamonds', true, 'p1-2d'),
      card('J', 'clubs', false, 'p1-Jc'),
      card('Q', 'clubs', false, 'p1-Qc'),
    ];
    const leaderCard = card('6', 'clubs', false, 'p0-6c');
    const engine = setupRespondingEngine({ botHand, leaderCard });

    // LegacyPreFixesStrategy: disableEndgameStrengthGate=true → orphanRvThreshold=2.
    // rv(9)=6 > 2 → hasStrandedLowCard=false → M-Stranded does NOT fire.
    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p1');

    // No M-Stranded. P6 conservation: 2s too expensive to beat rank-3 single,
    // bomb on non-bomb → conserve. Bot plays a cheap non-bomb single (J or Q).
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      // Should NOT play a 2-single or bomb (M-Stranded didn't fire)
      const is2Single = decision.cards.length === 1 && decision.cards[0].rank === '2';
      const isBomb = decision.cards.length >= 3;
      expect(is2Single).toBe(false);
      expect(isBomb).toBe(false);
    }
  });

  /**
   * Test 5: Bug fix — handSize=2 default fallback plays LOWEST (not first in array).
   *
   * Bot hand: [K♥, 3♠] (K is first in array, 3 is second).
   * tryingToExit=true (handSize=2). All opponents at fillerSize=5 (opponentMinHand=5).
   * detectFormat([K♥, 3♠]) = null (not a pair or straight).
   * opponentMinHand(5) > 2 → NEW code: byAsc = [3♠, K♥]; return 3♠.
   * OLD BUG: returned player.hand[0] = K♥ (first in deal order).
   */
  it('Test 5: handSize=2 default fallback leads LOWEST card (3♠), not first in array (K♥)', () => {
    const p0Hand: Card[] = [
      card('K', 'hearts', true, 'p0-Kh'),  // first in array
      card('3', 'spades', false, 'p0-3s'), // second in array
    ];
    // fillerSize=5 ensures opponentMinHand=5 > 2, avoiding the "lead highest" branch.
    const engine = setupOpeningEngine(p0Hand, 5);
    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('3'); // LOWEST, not K (first in array)
    }
  });

  /**
   * Test 6: handSize=2 near-exit opponent leads HIGHEST card.
   *
   * Bot hand: [3♠, K♥]. One opponent at handSize=1 (opponentMinHand=1 ≤ 2).
   * tryingToExit=true. detectFormat([3,K]) = null.
   * opponentMinHand(1) ≤ 2 → byDesc[0] = K♥. Leads K♥ to block.
   */
  it('Test 6: handSize=2 with near-exit opponent (opponentMinHand=1) leads HIGHEST (K♥)', () => {
    const p0Hand: Card[] = [
      card('3', 'spades', false, 'p0-3s'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    const engine = setupOpeningEngine(p0Hand, 5);
    const state = engine.getState();

    // Set one opponent (p2, black10) to handSize=1 so opponentMinHand=1.
    // p0 is black10, so opponents of p0 (black10) are red10 players: p1, p3, p5.
    // But wait — in this test p0 IS the bot (black10). Opponents of black10 = red10 players.
    // Default team setup: p0=black10, p1=red10, p2=black10, p3=red10, p4=black10, p5=red10.
    // So p0's opponents are p1, p3, p5 (red10). Let's set p1 to handSize=1.
    state.players[1].handSize = 1;
    state.players[1].hand = [card('3', 'clubs', false, 'p1-3c')];

    const decision = SmartRacerStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('K'); // HIGHEST to block near-exit opponent
    }
  });

  /**
   * Test 7: Legacy bypass — race mode preserved for weak hand.
   *
   * Same hand as Test 1 ([3♠, 6♠, 7♣, K♥]), but using LegacyPreFixesStrategy
   * (disableEndgameStrengthGate=true). Race mode fires regardless of hand strength.
   * Race-mode scoring (score += avgRank):
   *   K♥ single: 10 + avgRank(10) = 20
   *   7♣ single: 10 + avgRank(4)  = 14
   *   6♠ single: 10 + avgRank(3)  = 13
   *   3♠ single: 10 + avgRank(0)  = 10
   * K♥ wins. Bot leads K♥ (race mode behavior restored for legacy).
   */
  it('Test 7: LegacyPreFixesStrategy preserves race mode — leads K♥ (highest)', () => {
    const p0Hand: Card[] = [
      card('3', 'spades', false, 'p0-3s'),
      card('6', 'spades', false, 'p0-6s'),
      card('7', 'clubs', false, 'p0-7c'),
      card('K', 'hearts', true, 'p0-Kh'),
    ];
    const engine = setupOpeningEngine(p0Hand);
    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p0');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBe(1);
      expect(decision.cards[0].rank).toBe('K'); // Race mode: leads highest
    }
  });
});
