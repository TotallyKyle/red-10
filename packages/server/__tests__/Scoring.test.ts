import { describe, it, expect } from 'vitest';
import { calculateScore } from '../src/game/Scoring.js';
import { GameEngine } from '../src/game/GameEngine.js';
import type { GameState, Card, Team } from '@red10/shared';

// Helper to create a card
function card(rank: string, suit: string, isRed: boolean): Card {
  return { id: `${suit}-${rank}`, suit: suit as Card['suit'], rank: rank as Card['rank'], isRed };
}

// Helper to create a set of players
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
 * Creates a GameEngine with predetermined hands.
 */
function createEngineWithHands(hands: Card[][]): GameEngine {
  const engine = new GameEngine('test-room', makePlayers());
  engine.startGame();

  const state = engine.getState();
  for (let i = 0; i < 6; i++) {
    state.players[i].hand = hands[i];
    state.players[i].handSize = hands[i].length;
    const hasRed10 = hands[i].some((c) => c.rank === '10' && c.isRed);
    state.players[i].team = hasRed10 ? 'red10' : 'black10';
  }

  state.phase = 'playing';
  state.doubling = null;
  engine.startNewRound('p0');

  return engine;
}

/**
 * Build a mock GameState for pure scoring tests.
 * teams: array of 6 team assignments
 * finishOrder: player IDs in order of finishing
 * outPlayers: player IDs that are out (have no cards)
 * stakeMultiplier: the multiplier
 */
function buildGameState(opts: {
  teams: Team[];
  finishOrder: string[];
  outPlayers: string[];
  stakeMultiplier?: number;
  scoringTeam: Team;
}): GameState {
  const playerIds = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const players = playerIds.map((id, i) => ({
    id,
    name: `Player${i}`,
    seatIndex: i,
    hand: opts.outPlayers.includes(id) ? [] : [card('3', 'hearts', true)], // dummy card if not out
    handSize: opts.outPlayers.includes(id) ? 0 : 1,
    isOut: true, // all marked out at game over
    finishOrder: opts.finishOrder.indexOf(id) !== -1 ? opts.finishOrder.indexOf(id) + 1 : null,
    team: opts.teams[i],
    revealedRed10Count: 0,
    isConnected: true,
  }));

  return {
    id: 'test',
    phase: 'game_over',
    players,
    round: null,
    doubling: null,
    stakeMultiplier: opts.stakeMultiplier ?? 1,
    turnOrder: playerIds,
    finishOrder: opts.finishOrder,
    scoringTeam: opts.scoringTeam,
    previousGameWinner: null,
  };
}

describe('Scoring — calculateScore', () => {
  it('basic scoring: scoring team (3 members) wins, 2 trapped', () => {
    // Red 10 team: p0, p1, p2 (scoring team)
    // Black 10 team: p3, p4, p5
    // Finish order: p0 (1st, sets scoring), p1, p3 (opposing finished), p2 (all scoring done)
    // Then p4, p5 are trapped
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p3', 'p2', 'p4', 'p5'],
      outPlayers: ['p0', 'p1', 'p2', 'p3'], // p4, p5 still have cards
      stakeMultiplier: 1,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeam).toBe('red10');
    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped).toEqual(expect.arrayContaining(['p4', 'p5']));
    expect(result.trapped.length).toBe(2);
    expect(result.payoutPerTrapped).toBe(1);

    // Each loser pays stakeMultiplier × trappedCount = $1 × 2 = $2
    expect(result.payouts['p3']).toBe(-2);
    expect(result.payouts['p4']).toBe(-2);
    expect(result.payouts['p5']).toBe(-2);

    // Each winner receives stakeMultiplier × trappedCount = $1 × 2 = $2
    expect(result.payouts['p0']).toBe(2);
    expect(result.payouts['p1']).toBe(2);
    expect(result.payouts['p2']).toBe(2);
  });

  it('scoring team fails: all opposing finish first', () => {
    // Red 10 team: p0, p1, p2 (scoring team, set by p0)
    // Black 10 team: p3, p4, p5
    // Opposing all finish before scoring team completes
    // Finish order: p0 (sets scoring), p3, p4, p5 (all opposing done), p1, p2
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p3', 'p4', 'p5', 'p1', 'p2'],
      outPlayers: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      stakeMultiplier: 1,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeam).toBe('red10');
    expect(result.scoringTeamWon).toBe(false);
    expect(result.trapped.length).toBe(0);
    expect(result.payoutPerTrapped).toBe(0);

    // All payouts should be $0
    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) {
      expect(result.payouts[id]).toBe(0);
    }
  });

  it('doubled stakes: multiplier = 2, verify payouts doubled', () => {
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      outPlayers: ['p0', 'p1', 'p2'], // p3, p4, p5 trapped
      stakeMultiplier: 2,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(3);
    expect(result.payoutPerTrapped).toBe(2);

    // Each loser pays $2 × 3 trapped = $6
    expect(result.payouts['p3']).toBe(-6);
    expect(result.payouts['p4']).toBe(-6);
    expect(result.payouts['p5']).toBe(-6);

    // Each winner receives $2 × 3 trapped = $6
    expect(result.payouts['p0']).toBe(6);
    expect(result.payouts['p1']).toBe(6);
    expect(result.payouts['p2']).toBe(6);
  });

  it('quadrupled stakes: multiplier = 4, 1 trapped', () => {
    // 3v3, x4 stakes, only 1 trapped
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p3', 'p4', 'p2', 'p5'],
      outPlayers: ['p0', 'p1', 'p2', 'p3', 'p4'], // only p5 trapped
      stakeMultiplier: 4,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(1);
    expect(result.payoutPerTrapped).toBe(4);

    // Each loser pays $4 × 1 trapped = $4
    expect(result.payouts['p3']).toBe(-4);
    expect(result.payouts['p4']).toBe(-4);
    expect(result.payouts['p5']).toBe(-4);

    // Each winner receives $4 × 1 trapped = $4
    expect(result.payouts['p0']).toBe(4);
    expect(result.payouts['p1']).toBe(4);
    expect(result.payouts['p2']).toBe(4);
  });

  it('4v2 team composition: small team wins, big team loses (all 4 trapped)', () => {
    // Red 10 team: p0, p1 (2 members, scoring)
    // Black 10 team: p2, p3, p4, p5 (4 members, all trapped)
    const state = buildGameState({
      teams: ['red10', 'red10', 'black10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      outPlayers: ['p0', 'p1'], // all 4 black members trapped
      stakeMultiplier: 1,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(4);

    // Each winner receives $1 × 4 trapped = $4
    expect(result.payouts['p0']).toBe(4);
    expect(result.payouts['p1']).toBe(4);

    // Total pool: 2 winners × $4 = $8, split among 4 losers = $2 each
    expect(result.payouts['p2']).toBe(-2);
    expect(result.payouts['p3']).toBe(-2);
    expect(result.payouts['p4']).toBe(-2);
    expect(result.payouts['p5']).toBe(-2);
  });

  it('4v2 team composition: big team wins, small team loses (all 2 trapped)', () => {
    // Red 10 team: p0, p1 (2 members, all trapped)
    // Black 10 team: p2, p3, p4, p5 (4 members, scoring)
    const state = buildGameState({
      teams: ['red10', 'red10', 'black10', 'black10', 'black10', 'black10'],
      finishOrder: ['p2', 'p3', 'p4', 'p5', 'p0', 'p1'],
      outPlayers: ['p2', 'p3', 'p4', 'p5'], // both red members trapped
      stakeMultiplier: 1,
      scoringTeam: 'black10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(2);

    // Each winner receives $1 × 2 trapped = $2
    expect(result.payouts['p2']).toBe(2);
    expect(result.payouts['p3']).toBe(2);
    expect(result.payouts['p4']).toBe(2);
    expect(result.payouts['p5']).toBe(2);

    // Total pool: 4 winners × $2 = $8, split among 2 losers = $4 each
    expect(result.payouts['p0']).toBe(-4);
    expect(result.payouts['p1']).toBe(-4);
  });

  it('4v2 team composition: big team wins, 1 trapped', () => {
    // Black 10 team: p2, p3, p4, p5 (4 members, scoring)
    // Red 10 team: p0, p1 (2 members, p0 got out, p1 trapped)
    const state = buildGameState({
      teams: ['red10', 'red10', 'black10', 'black10', 'black10', 'black10'],
      finishOrder: ['p2', 'p0', 'p3', 'p4', 'p5', 'p1'],
      outPlayers: ['p2', 'p3', 'p4', 'p5', 'p0'], // only p1 trapped
      stakeMultiplier: 1,
      scoringTeam: 'black10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(1);

    // Each winner receives $1 × 1 trapped = $1
    expect(result.payouts['p2']).toBe(1);
    expect(result.payouts['p3']).toBe(1);
    expect(result.payouts['p4']).toBe(1);
    expect(result.payouts['p5']).toBe(1);

    // Total pool: 4 winners × $1 = $4, split among 2 losers = $2 each
    expect(result.payouts['p0']).toBe(-2);
    expect(result.payouts['p1']).toBe(-2);
  });

  it('5v1 team composition: only 1 red 10 player wins', () => {
    // Red 10 team: p0 (1 member, scoring)
    // Black 10 team: p1, p2, p3, p4, p5 (5 members, all trapped)
    const state = buildGameState({
      teams: ['red10', 'black10', 'black10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      outPlayers: ['p0'], // all 5 black members trapped
      stakeMultiplier: 1,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(5);

    // Each winner receives $1 × 5 trapped = $5
    expect(result.payouts['p0']).toBe(5);

    // Total pool: 1 winner × $5 = $5, split among 5 losers = $1 each
    expect(result.payouts['p1']).toBe(-1);
    expect(result.payouts['p2']).toBe(-1);
    expect(result.payouts['p3']).toBe(-1);
    expect(result.payouts['p4']).toBe(-1);
    expect(result.payouts['p5']).toBe(-1);
  });

  it('5v1 team composition: big team wins, 1 player trapped', () => {
    // Black 10 team: p1, p2, p3, p4, p5 (5 members, scoring)
    // Red 10 team: p0 (1 member, trapped)
    const state = buildGameState({
      teams: ['red10', 'black10', 'black10', 'black10', 'black10', 'black10'],
      finishOrder: ['p1', 'p2', 'p3', 'p4', 'p5', 'p0'],
      outPlayers: ['p1', 'p2', 'p3', 'p4', 'p5'], // p0 trapped
      stakeMultiplier: 1,
      scoringTeam: 'black10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(1);

    // Each winner receives $1 × 1 trapped = $1
    expect(result.payouts['p1']).toBe(1);
    expect(result.payouts['p5']).toBe(1);

    // Total pool: 5 winners × $1 = $5, split among 1 loser = $5
    expect(result.payouts['p0']).toBe(-5);
  });

  it('all trapped: none of opposing team finished', () => {
    // Scoring team (red10): p0, p1, p2 all finish
    // Opposing (black10): p3, p4, p5 none finished naturally
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      outPlayers: ['p0', 'p1', 'p2'], // all opposing trapped
      stakeMultiplier: 1,
      scoringTeam: 'red10',
    });

    const result = calculateScore(state);

    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(3);
    expect(result.trapped).toEqual(expect.arrayContaining(['p3', 'p4', 'p5']));
  });

  it('first player out sets scoring team correctly', () => {
    // p3 (black10) goes out first
    const state = buildGameState({
      teams: ['red10', 'red10', 'red10', 'black10', 'black10', 'black10'],
      finishOrder: ['p3', 'p4', 'p5', 'p0', 'p1', 'p2'],
      outPlayers: ['p3', 'p4', 'p5'], // all black out, red trapped
      stakeMultiplier: 1,
      scoringTeam: 'black10', // set by p3 going out first
    });

    const result = calculateScore(state);

    expect(result.scoringTeam).toBe('black10');
    expect(result.scoringTeamWon).toBe(true);
    expect(result.trapped.length).toBe(3);
    expect(result.trapped).toEqual(expect.arrayContaining(['p0', 'p1', 'p2']));

    // Each loser pays $1 × 3 trapped = $3
    expect(result.payouts['p0']).toBe(-3);
    // Total pool: 3 losers × $3 = $9, split among 3 winners = $3 each
    expect(result.payouts['p3']).toBe(3);
  });
});

describe('Scoring — integration via GameEngine', () => {
  it('game ends and scoring is calculated when all scoring team members finish', () => {
    // Set up a game where p0 (red10) and p2 (red10) each have 1 card
    // p1-p5 (black10) have cards too
    // We'll make p0 and p2 go out, then verify scoring
    const hands: Card[][] = [
      [card('10', 'hearts', true)],   // p0: red 10 (red10 team) — 1 card
      [card('3', 'clubs', false), card('4', 'clubs', false)],  // p1: black10
      [card('10', 'hearts2', true)],   // p2: red 10 (red10 team) — 1 card
      [card('5', 'clubs', false), card('6', 'clubs', false)],  // p3: black10
      [card('7', 'clubs', false), card('8', 'clubs', false)],  // p4: black10
      [card('9', 'clubs', false), card('J', 'clubs', false)],  // p5: black10
    ];

    const engine = createEngineWithHands(hands);

    // p0 leads with red 10 (goes out)
    engine.playCards('p0', [card('10', 'hearts', true)]);

    const state1 = engine.getState();
    expect(state1.scoringTeam).toBe('red10');
    expect(state1.players[0].isOut).toBe(true);

    // Everyone passes so round ends, then p2 leads next round (or we advance)
    // Since p0 went out, the next player should continue
    // Let's have everyone pass to end the round
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');
    // After 4 passes (5 active - 1 = 4 needed), round ends. p0 won, but out, so next active leads

    // New round: leader should be next active player after p0
    const state2 = engine.getState();
    if (state2.phase === 'playing' && state2.round) {
      // p2 needs to play their card to go out
      // Navigate to p2's turn
      const currentId = state2.round.currentPlayerId;
      if (currentId === 'p1') {
        engine.playCards('p1', [card('3', 'clubs', false)]);
        // p2's turn
        engine.playCards('p2', [card('10', 'hearts2', true)]);
      } else if (currentId === 'p2') {
        engine.playCards('p2', [card('10', 'hearts2', true)]);
      } else {
        // Skip to p2's turn via passes
        let st = engine.getState();
        while (st.phase === 'playing' && st.round && st.round.currentPlayerId !== 'p2') {
          const cur = st.round.currentPlayerId;
          if (st.round.currentFormat === null && st.round.leaderId === cur) {
            // Leader must play
            const leader = st.players.find(p => p.id === cur)!;
            if (leader.hand.length > 0) {
              engine.playCards(cur, [leader.hand[0]]);
            }
          } else {
            engine.pass(cur);
          }
          st = engine.getState();
        }
        if (st.phase === 'playing' && st.round) {
          engine.playCards('p2', [card('10', 'hearts2', true)]);
        }
      }
    }

    // Now check if game ended
    const finalState = engine.getState();
    expect(finalState.phase).toBe('game_over');

    const gameResult = engine.getGameResult();
    expect(gameResult).not.toBeNull();
    expect(gameResult!.scoringTeam).toBe('red10');
    expect(gameResult!.scoringTeamWon).toBe(true);
  });

  it('play again resets the game', () => {
    // Create a quick game that ends immediately
    const hands: Card[][] = [
      [card('10', 'hearts', true)],   // p0: 1 card
      [card('3', 'clubs', false)],     // p1: 1 card
      [card('10', 'hearts2', true)],   // p2: 1 card
      [card('5', 'clubs', false)],     // p3: 1 card
      [card('7', 'clubs', false)],     // p4: 1 card
      [card('9', 'clubs', false)],     // p5: 1 card
    ];

    const engine = createEngineWithHands(hands);

    // p0 plays and goes out (sets scoring team)
    engine.playCards('p0', [card('10', 'hearts', true)]);

    // Everyone passes
    engine.pass('p1');
    engine.pass('p2');
    engine.pass('p3');
    engine.pass('p4');

    // New round, next leader plays and everyone goes out eventually
    // Let's speed this up — just get to game_over
    let state = engine.getState();
    let iterations = 0;
    while (state.phase === 'playing' && iterations < 50) {
      iterations++;
      if (!state.round) break;
      const cur = state.round.currentPlayerId;
      const player = state.players.find(p => p.id === cur);
      if (!player || player.isOut) break;

      if (state.round.currentFormat === null && state.round.leaderId === cur) {
        // Leader must play
        if (player.hand.length > 0) {
          engine.playCards(cur, [player.hand[0]]);
        }
      } else if (player.hand.length > 0 && state.round.lastPlay) {
        // Try to play or pass
        engine.pass(cur);
      } else if (player.hand.length > 0) {
        engine.playCards(cur, [player.hand[0]]);
      } else {
        engine.pass(cur);
      }
      state = engine.getState();
    }

    // Make sure game is over
    expect(state.phase).toBe('game_over');

    // Now test play again
    const r1 = engine.playAgain('p0');
    expect(r1.allReady).toBe(false);
    expect(r1.count).toBe(1);

    engine.playAgain('p1');
    engine.playAgain('p2');
    engine.playAgain('p3');
    engine.playAgain('p4');

    const r6 = engine.playAgain('p5');
    expect(r6.allReady).toBe(true);

    // Game should be reset to doubling phase
    const newState = engine.getState();
    expect(newState.phase).toBe('doubling');
    expect(newState.scoringTeam).toBeNull();
    expect(newState.finishOrder.length).toBe(0);
    expect(newState.stakeMultiplier).toBe(1);

    // All players should have new hands
    for (const p of newState.players) {
      expect(p.isOut).toBe(false);
      expect(p.finishOrder).toBeNull();
      expect(p.hand.length).toBeGreaterThan(0);
      expect(p.revealedRed10Count).toBe(0);
    }

    // Game result should be cleared
    expect(engine.getGameResult()).toBeNull();
  });
});
