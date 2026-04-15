import type { GameState, GameResult, Team } from '@red10/shared';

/**
 * Calculate the game result (scoring) from a completed game state.
 * Pure function: takes GameState, returns GameResult.
 */
export function calculateScore(state: GameState): GameResult {
  const scoringTeam = state.scoringTeam;

  // If no scoring team was set (shouldn't happen in a normal game), default to red10
  if (!scoringTeam) {
    return {
      scoringTeam: 'red10',
      scoringTeamWon: false,
      trapped: [],
      payoutPerTrapped: 0,
      payouts: Object.fromEntries(state.players.map((p) => [p.id, 0])),
    };
  }

  const opposingTeam: Team = scoringTeam === 'red10' ? 'black10' : 'red10';

  const scoringMembers = state.players.filter((p) => p.team === scoringTeam);
  const opposingMembers = state.players.filter((p) => p.team === opposingTeam);

  // Determine if the scoring team won using finish order.
  // The scoring team wins if ALL its members finished before ALL opposing members finished.
  // Specifically: the last scoring member's finishOrder must be earlier than the last opposing member's finishOrder.
  // In other words, all scoring members must have gone out before the last opposing member.
  const lastScoringFinishOrder = Math.max(
    ...scoringMembers.map((p) => p.finishOrder ?? Infinity),
  );
  const lastOpposingFinishOrder = Math.max(
    ...opposingMembers.map((p) => p.finishOrder ?? Infinity),
  );

  // Scoring team wins if all its members finished, and the last scoring member
  // finished before the last opposing member (i.e., all scoring went out first).
  const allScoringHaveFinishOrder = scoringMembers.every((p) => p.finishOrder !== null);
  const scoringTeamWon = allScoringHaveFinishOrder && lastScoringFinishOrder < lastOpposingFinishOrder;

  const payouts: Record<string, number> = {};
  for (const p of state.players) {
    payouts[p.id] = 0;
  }

  let trapped: string[] = [];
  let payoutPerTrapped = 0;

  if (scoringTeamWon) {
    // Trapped = opposing members whose finishOrder is AFTER the last scoring member's finishOrder.
    // These are the players who still had cards when the scoring team completed.
    trapped = opposingMembers
      .filter((p) => (p.finishOrder ?? Infinity) > lastScoringFinishOrder)
      .map((p) => p.id);

    const trappedCount = trapped.length;
    payoutPerTrapped = state.stakeMultiplier * 1;

    // Each trapped player pays payoutPerTrapped to EACH scoring team member
    for (const trappedId of trapped) {
      payouts[trappedId] = -(payoutPerTrapped * scoringMembers.length);
    }

    // Each scoring team member receives payoutPerTrapped * trappedCount
    for (const member of scoringMembers) {
      payouts[member.id] = payoutPerTrapped * trappedCount;
    }
  }

  return {
    scoringTeam,
    scoringTeamWon,
    trapped,
    payoutPerTrapped,
    payouts,
  };
}
