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
 * Build a unique filler hand for the given player prefix.
 * Uses a predictable naming scheme to avoid card ID collisions.
 */
function fillerHand(prefix: string, size = 4): Card[] {
  const entries: [string, string, boolean][] = [
    ['3', 'spades', false],
    ['4', 'spades', false],
    ['6', 'spades', false],
    ['7', 'spades', false],
    ['8', 'spades', false],
    ['9', 'spades', false],
  ];
  return entries.slice(0, size).map(([rank, suit, isRed]) =>
    card(rank, suit, isRed, `${prefix}-${rank}s`),
  );
}

/**
 * Core test setup:
 * - p0 (opponent, black10) leads `leaderCard` from `p0ExtraCards`
 * - p1 (bot, red10) responds — this is the decision-maker
 * - p2 (opponent, black10) has a filler hand (4 cards)
 * - p3–p5 have filler hands (4 cards each); their team/handSize are set post-setup
 *
 * After returning, callers should set state.doubling and adjust p3-p5 team/handSize
 * as needed for their specific test scenario.
 */
function buildEngine(opts: {
  botHand: Card[];
  leaderCard: Card;
  leaderExtraCards?: Card[];
}) {
  const { botHand, leaderCard, leaderExtraCards = fillerHand('p0extra', 4) } = opts;

  const p0Hand = [leaderCard, ...leaderExtraCards];
  const hands: Card[][] = [
    p0Hand,
    botHand,
    fillerHand('p2', 4),
    fillerHand('p3', 4),
    fillerHand('p4', 4),
    fillerHand('p5', 4),
  ];
  // p0 = opponent (black10), p1 = bot (red10), others = opponents by default
  const teams: ('red10' | 'black10')[] = [
    'black10', 'red10', 'black10', 'black10', 'black10', 'black10',
  ];

  const engine = new GameEngine('teammate-rescue-test', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    state.players[i].team = teams[i];
  }
  state.phase = 'playing';
  state.doubling = null;
  engine.startNewRound('p0');

  const result = engine.playCards('p0', [leaderCard]);
  if (!result.success) throw new Error(`Setup play failed: ${result.error}`);

  return engine;
}

/**
 * Helper: add a stranded teammate to the given engine state.
 * Sets p3 (or playerIdx) to 'red10' team with handSize=1 and a single card.
 */
function setStrandedTeammate(
  state: ReturnType<GameEngine['getState']>,
  playerIdx: number,
  handCard: Card,
) {
  state.players[playerIdx].team = 'red10';
  state.players[playerIdx].handSize = 1;
  state.players[playerIdx].hand = [handCard];
}

/** Bot hand with extra power: 2 bomb ranks (J×3, Q×3) + fillers */
function powerBotHand(): Card[] {
  return [
    card('J', 'hearts', true, 'p1-Jh'),
    card('J', 'spades', false, 'p1-Js'),
    card('J', 'clubs', false, 'p1-Jc'),
    card('Q', 'hearts', true, 'p1-Qh'),
    card('Q', 'spades', false, 'p1-Qs'),
    card('Q', 'clubs', false, 'p1-Qc'),
    card('6', 'clubs', false, 'p1-6c'),
    card('7', 'clubs', false, 'p1-7c'),
    card('8', 'clubs', false, 'p1-8c'),
    card('9', 'clubs', false, 'p1-9c'),
  ];
}

/** Bot hand with extra power: 2 bomb ranks (J×3, Q×3) + 1 filler */
function powerBotHandSmall(): Card[] {
  return [
    card('J', 'hearts', true, 'p1-Jh'),
    card('J', 'spades', false, 'p1-Js'),
    card('J', 'clubs', false, 'p1-Jc'),
    card('Q', 'hearts', true, 'p1-Qh'),
    card('Q', 'spades', false, 'p1-Qs'),
    card('Q', 'clubs', false, 'p1-Qc'),
    card('6', 'clubs', false, 'p1-6c'),
  ];
}

// ---- Tests ----

describe('M-RescueTeammate', () => {
  /**
   * Test 1: Triggers — teams revealed via doubling, teammate at handSize=1,
   * bot has extra power (2 bomb ranks) → rescue fires, bot plays a bomb.
   */
  it('Test 1: triggers when teams revealed + teammate handSize=1 + extra power', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHand(), leaderCard });
    const state = engine.getState();

    // Publicly reveal teams
    (state as any).doubling = { teamsRevealed: true };

    // p3 is a confirmed red10 teammate at handSize=1
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // Rescue fires: bot should play a bomb (no '2' in hand → must be J×3 or Q×3)
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(true);
    }
  });

  /**
   * Test 2: No extra power — bot has only 1 bomb rank, no twos → no rescue.
   * Bot may pass or play a cheap non-bomb card, but should NOT fire rescue.
   */
  it('Test 2: no rescue when bot lacks extra power (only 1 bomb rank, no twos)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    // Only 1 bomb rank (J×3)
    const botHand: Card[] = [
      card('J', 'hearts', true, 'p1-Jh'),
      card('J', 'spades', false, 'p1-Js'),
      card('J', 'clubs', false, 'p1-Jc'),
      card('6', 'clubs', false, 'p1-6c'),
      card('7', 'clubs', false, 'p1-7c'),
      card('8', 'clubs', false, 'p1-8c'),
    ];
    const engine = buildEngine({ botHand, leaderCard });
    const state = engine.getState();
    (state as any).doubling = { teamsRevealed: true };
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // No rescue (no extra power). Bot plays cheapest non-bomb beat (6♣ beats 5♣)
    // or passes depending on P6 logic. Either way, no bomb should be used for rescue.
    if (decision.action === 'play') {
      // If playing, should be a cheap non-bomb (J bomb is the only bomb, no rescue)
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(false); // No rescue → no bomb burn
    }
    // pass is also valid; we just verify no bomb is played for rescue
    expect(['play', 'pass']).toContain(decision.action);
  });

  /**
   * Test 3: Teammate at handSize=2, not 1 → no rescue trigger.
   * With 2 bomb ranks and opponent's low-5 single, but teammate handSize=2,
   * rescue doesn't fire. Bot should pass in P6 (bomb on non-bomb = conserve).
   */
  it('Test 3: no rescue when teammate handSize=2 (not 1)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHandSmall(), leaderCard });
    const state = engine.getState();
    (state as any).doubling = { teamsRevealed: true };

    // Teammate p3 at handSize=2 (NOT 1) — rescue should NOT fire
    state.players[3].team = 'red10';
    state.players[3].handSize = 2;
    state.players[3].hand = [
      card('3', 'diamonds', true, 'p3-a'),
      card('4', 'diamonds', true, 'p3-b'),
    ];

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // P6 conservation: bombs on non-bomb format → pass.
    // No rescue (teammate not at handSize=1), and P6 passes on bomb plays.
    // Bot may play a cheap non-bomb (6♣) or pass.
    // We verify: NO bomb is played.
    if (decision.action === 'play') {
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(false); // rescue didn't fire
    }
    expect(['play', 'pass']).toContain(decision.action);
  });

  /**
   * Test 4: Teams not revealed, no red10 plays — no rescue.
   * Even though teammate p3 is at handSize=1, bot can't publicly confirm they're
   * a teammate, so rescue must not fire.
   */
  it('Test 4: no rescue when teams not publicly known', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHandSmall(), leaderCard });
    const state = engine.getState();

    // Teams NOT publicly revealed (doubling=null), no red10 reveals
    // state.doubling remains null (set by buildEngine already)
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));
    state.players[3].revealedRed10Count = 0; // No red10 revealed

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // No rescue. In P6, bomb on non-bomb format → pass (or play cheap non-bomb).
    if (decision.action === 'play') {
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(false); // rescue didn't fire — no bomb burn
    }
    expect(['play', 'pass']).toContain(decision.action);
  });

  /**
   * Test 5: Teams revealed via red-10 play (no doubling reveal).
   * doubling.teamsRevealed=false, but teammate p3 has revealedRed10Count=1
   * → publicly confirmed. Rescue DOES trigger.
   */
  it('Test 5: triggers when teammate revealed via red-10 play (no doubling)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHandSmall(), leaderCard });
    const state = engine.getState();

    // No doubling reveal, but p3 has played a red 10 → publicly identified teammate
    // state.doubling remains null (teamsRevealed implicitly false)
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));
    state.players[3].revealedRed10Count = 1; // Played a red 10 — publicly known

    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');

    // Rescue fires: revealedRed10Count > 0 → publicly confirmed teammate
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(true);
    }
  });

  /**
   * Test 6: Opponent at handSize=1 (not a teammate) — no rescue.
   * highThreat=true triggers P3 must-block, which bombs the opponent.
   * The rescue check doesn't confuse an opponent's stranded state for a teammate's.
   */
  it('Test 6: no rescue when only opponent is at handSize=1 (P3 must-block fires instead)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHandSmall(), leaderCard });
    const state = engine.getState();
    (state as any).doubling = { teamsRevealed: true };

    // p2 (already black10/opponent) at handSize=1
    state.players[2].handSize = 1;
    state.players[2].hand = [card('3', 'clubs', false, 'p2-stranded')];
    // No red10 teammate at handSize=1 — p3 stays as black10 with normal hand

    // highThreat=true (opponentMinHand=1) → P3 must-block → bot will bomb
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards.length).toBeGreaterThan(0);
    }
  });

  /**
   * Test 7: Bot itself at handSize=1 (P1 tryingToExit takes priority).
   * Even if a teammate is also stranded, P1 fires first and bot plays its exit card.
   */
  it('Test 7: P1 (tryingToExit) takes priority over rescue when bot has 1 card', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const exitCard = card('8', 'clubs', false, 'p1-exit8c');
    const engine = buildEngine({ botHand: [exitCard], leaderCard });
    const state = engine.getState();
    (state as any).doubling = { teamsRevealed: true };

    // p3 teammate also at handSize=1
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));

    // Bot has 1 card (handSize=1) → tryingToExit=true. P1 fires, plays exit card.
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('play');
    if (decision.action === 'play') {
      expect(decision.cards[0].rank).toBe('8');
    }
  });

  /**
   * Test 8: Last play is by a teammate (P2 fires before rescue).
   * p0 and p1 are both red10 (teammates). p0 leads. Bot should pass (P2),
   * not burn a winner for rescue.
   */
  it('Test 8: passes when last play is by a teammate (P2 fires before rescue)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({
      botHand: powerBotHandSmall(),
      leaderCard,
    });
    const state = engine.getState();

    // Override: make p0 a teammate (both p0 and p1 are red10)
    state.players[0].team = 'red10';
    (state as any).doubling = { teamsRevealed: true };

    // p3 teammate at handSize=1
    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));

    // P2: last play by teammate (p0) → pass
    const decision = SmartRacerStrategy.decidePlay(engine, 'p1');
    expect(decision.action).toBe('pass');
  });

  /**
   * Test 9: LegacyPreFixesStrategy — disableTeammateRescue=true, no rescue.
   * Same conditions as Test 1 (teams revealed, teammate at handSize=1, extra power)
   * but using LegacyPreFixesStrategy. No rescue should fire.
   */
  it('Test 9: LegacyPreFixesStrategy does NOT rescue (disableTeammateRescue=true)', () => {
    const leaderCard = card('5', 'clubs', false, 'p0-5c');
    const engine = buildEngine({ botHand: powerBotHandSmall(), leaderCard });
    const state = engine.getState();
    (state as any).doubling = { teamsRevealed: true };

    setStrandedTeammate(state, 3, card('3', 'diamonds', true, 'p3-stranded'));

    // LegacyPreFixesStrategy: disableTeammateRescue=true — rescue does NOT fire
    const decision = LegacyPreFixesStrategy.decidePlay(engine, 'p1');

    // Without rescue, bot should not play a bomb for rescue reason.
    // P6 conservation: bomb on non-bomb → pass. Or cheap non-bomb.
    if (decision.action === 'play') {
      const isBomb = decision.cards.length >= 3;
      expect(isBomb).toBe(false); // rescue didn't fire
    }
    expect(['play', 'pass']).toContain(decision.action);
  });
});
