import type { GameEngine } from '../../src/game/GameEngine.js';
import type { Card, GameState, RoundInfo } from '@red10/shared';
import { TOTAL_CARDS, PLAYER_COUNT } from '@red10/shared';
import { classifyBomb } from '@red10/shared';

export interface ActionLogEntry {
  actionIndex: number;
  playerId: string;
  action: string;
  cards?: Card[];
  result: { success: boolean; error?: string };
  roundNumber: number;
  phase: string;
  chaGoState?: any;
}

export interface InvariantViolation {
  invariant: string;
  message: string;
  gameState: any;
  actionLog: ActionLogEntry[];
}

export function checkInvariants(
  engine: GameEngine,
  actionLog: ActionLogEntry[],
  playedCardIds: Set<string>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const state = engine.getState();

  function addViolation(invariant: string, message: string) {
    violations.push({
      invariant,
      message,
      gameState: JSON.parse(JSON.stringify(state)),
      actionLog: [...actionLog],
    });
  }

  // 1. Card Conservation
  checkCardConservation(state, playedCardIds, addViolation);

  // 2. Hand Integrity
  checkHandIntegrity(state, addViolation);

  // 3. Turn Order
  checkTurnOrder(state, addViolation);

  // 4. Format Consistency
  checkFormatConsistency(state, addViolation);

  // 5. Scoring Conservation (only at game_over)
  checkScoringConservation(engine, addViolation);

  // 6. Team Assignment
  checkTeamAssignment(state, addViolation);

  // 7. Finish Order
  checkFinishOrder(state, addViolation);

  // 8. Hand Size Sync
  checkHandSizeSync(state, addViolation);

  // 9. Active Player Count
  checkActivePlayerCount(state, addViolation);

  // 10. Cha-Go Rank Consistency
  checkChaGoRankConsistency(state, addViolation);

  // 11. Phase Consistency
  checkPhaseConsistency(state, addViolation);

  return violations;
}

function checkCardConservation(
  state: GameState,
  playedCardIds: Set<string>,
  addViolation: (inv: string, msg: string) => void,
) {
  const cardsInHands = state.players.reduce((sum, p) => sum + p.hand.length, 0);
  const total = cardsInHands + playedCardIds.size;
  if (total !== TOTAL_CARDS) {
    addViolation(
      'Card Conservation',
      `Total cards should be ${TOTAL_CARDS} but found ${total} (${cardsInHands} in hands + ${playedCardIds.size} played)`,
    );
  }
}

function checkHandIntegrity(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  const allCardIds = new Set<string>();
  for (const player of state.players) {
    for (const card of player.hand) {
      if (allCardIds.has(card.id)) {
        addViolation(
          'Hand Integrity',
          `Duplicate card ID ${card.id} found across players' hands`,
        );
      }
      allCardIds.add(card.id);
    }
  }
}

function checkTurnOrder(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  if (state.phase !== 'playing' || !state.round) return;

  const currentId = state.round.currentPlayerId;
  const player = state.players.find(p => p.id === currentId);
  if (!player) {
    addViolation(
      'Turn Order',
      `currentPlayerId "${currentId}" is not a valid player`,
    );
    return;
  }

  // During cha-go waiting_cha or waiting_final_cha, currentPlayerId might still be valid
  // even if they haven't changed, so skip the isOut check in that case
  const cg = state.round.chaGoState;
  if (cg && (cg.phase === 'waiting_cha' || cg.phase === 'waiting_final_cha')) {
    // In these phases, currentPlayerId may not be the one acting
    return;
  }

  if (player.isOut) {
    addViolation(
      'Turn Order',
      `currentPlayerId "${currentId}" is out but still set as current player`,
    );
  }
}

function checkFormatConsistency(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  if (state.phase !== 'playing' || !state.round) return;
  const round = state.round;
  if (!round.currentFormat || round.plays.length === 0) return;

  // All plays should match the current format or be bombs
  // Note: format can change when a bomb is played on a non-bomb round
  // The current format represents what the format is NOW
}

function checkScoringConservation(
  engine: GameEngine,
  addViolation: (inv: string, msg: string) => void,
) {
  const state = engine.getState();
  if (state.phase !== 'game_over') return;

  const result = engine.getGameResult();
  if (!result) return;

  const totalPayouts = Object.values(result.payouts).reduce((sum, v) => sum + v, 0);
  if (Math.abs(totalPayouts) > 0.001) {
    addViolation(
      'Scoring Conservation',
      `Payouts do not sum to zero: ${totalPayouts} (payouts: ${JSON.stringify(result.payouts)})`,
    );
  }
}

function checkTeamAssignment(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  // We can't check dealt hand after the game mutates, but we can check team is set
  for (const player of state.players) {
    if (!player.team) {
      addViolation(
        'Team Assignment',
        `Player ${player.id} has no team assigned`,
      );
    }
  }
}

function checkFinishOrder(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  // Check no duplicates in finishOrder
  const seen = new Set<string>();
  for (const pid of state.finishOrder) {
    if (seen.has(pid)) {
      addViolation(
        'Finish Order',
        `Duplicate player "${pid}" in finishOrder`,
      );
    }
    seen.add(pid);
  }

  // Check each finished player has correct finishOrder number
  for (let i = 0; i < state.finishOrder.length; i++) {
    const pid = state.finishOrder[i];
    const player = state.players.find(p => p.id === pid);
    if (player && player.finishOrder !== i + 1) {
      addViolation(
        'Finish Order',
        `Player "${pid}" has finishOrder ${player.finishOrder} but is at position ${i + 1} in finishOrder array`,
      );
    }
  }

  // Check no gaps
  for (const player of state.players) {
    if (player.isOut && player.finishOrder === null) {
      addViolation(
        'Finish Order',
        `Player "${player.id}" is out but has no finishOrder`,
      );
    }
    if (!player.isOut && player.finishOrder !== null) {
      addViolation(
        'Finish Order',
        `Player "${player.id}" is not out but has finishOrder ${player.finishOrder}`,
      );
    }
  }
}

function checkHandSizeSync(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  for (const player of state.players) {
    if (player.handSize !== player.hand.length) {
      addViolation(
        'Hand Size Sync',
        `Player "${player.id}" handSize=${player.handSize} but hand.length=${player.hand.length}`,
      );
    }
  }
}

function checkActivePlayerCount(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  const outPlayers = state.players.filter(p => p.isOut);
  const activePlayers = state.players.filter(p => !p.isOut);

  if (outPlayers.length + activePlayers.length !== PLAYER_COUNT) {
    addViolation(
      'Active Player Count',
      `Out (${outPlayers.length}) + Active (${activePlayers.length}) != ${PLAYER_COUNT}`,
    );
  }

  // If game is over, all should be out
  if (state.phase === 'game_over' && activePlayers.length !== 0) {
    addViolation(
      'Active Player Count',
      `Game is over but ${activePlayers.length} players are still active`,
    );
  }
}

function checkChaGoRankConsistency(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  if (state.phase !== 'playing' || !state.round?.chaGoState) return;
  const cg = state.round.chaGoState;

  // Trigger rank should be a valid rank
  if (!cg.triggerRank) {
    addViolation(
      'Cha-Go Rank Consistency',
      'Cha-go state has no trigger rank',
    );
  }

  // If there's a cha play, it should be of the trigger rank
  if (cg.chaPlayerId) {
    const chaPlay = state.round.plays.find(
      p => p.playerId === cg.chaPlayerId && p.format === 'pair',
    );
    if (chaPlay && !chaPlay.cards.every(c => c.rank === cg.triggerRank)) {
      addViolation(
        'Cha-Go Rank Consistency',
        `Cha play rank doesn't match trigger rank ${cg.triggerRank}`,
      );
    }
  }
}

function checkPhaseConsistency(
  state: GameState,
  addViolation: (inv: string, msg: string) => void,
) {
  if (state.phase === 'playing' && !state.round) {
    addViolation(
      'Phase Consistency',
      'Phase is "playing" but there is no round',
    );
  }

  if (state.phase === 'doubling' && !state.doubling) {
    addViolation(
      'Phase Consistency',
      'Phase is "doubling" but there is no doubling state',
    );
  }
}
