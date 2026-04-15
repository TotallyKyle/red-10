import type {
  GameState,
  PlayerState,
  ClientGameView,
  ClientPlayerView,
  Team,
  Card,
  Play,
  PlayFormat,
  ActionType,
  RoundInfo,
} from '@red10/shared';
import { detectFormat, canBeat, getPlayValue, classifyBomb, rankValue, PLAYER_COUNT } from '@red10/shared';
import { createDeck, shuffle, deal } from './Deck.js';

interface PlayerInit {
  id: string;
  name: string;
  seatIndex: number;
}

export class GameEngine {
  private state: GameState;

  constructor(roomId: string, players: PlayerInit[]) {
    const playerStates: PlayerState[] = players.map((p) => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      hand: [],
      handSize: 0,
      isOut: false,
      finishOrder: null,
      team: null,
      revealedRed10Count: 0,
      isConnected: true,
    }));

    // Build turn order clockwise from seat 0
    const sorted = [...playerStates].sort((a, b) => a.seatIndex - b.seatIndex);
    const turnOrder = sorted.map((p) => p.id);

    this.state = {
      id: roomId,
      phase: 'lobby',
      players: playerStates,
      round: null,
      doubling: null,
      stakeMultiplier: 1,
      turnOrder,
      finishOrder: [],
      scoringTeam: null,
      previousGameWinner: null,
    };
  }

  /**
   * Deal cards, assign teams based on red 10 ownership, move to playing phase.
   */
  startGame(): void {
    const deck = shuffle(createDeck());
    const hands = deal(deck);

    // Sort players by seatIndex to assign hands in seat order
    const sortedPlayers = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);

    for (let i = 0; i < sortedPlayers.length; i++) {
      const player = this.state.players.find((p) => p.id === sortedPlayers[i].id)!;
      player.hand = hands[i];
      player.handSize = hands[i].length;
    }

    // Assign teams based on red 10 ownership
    for (const player of this.state.players) {
      const hasRed10 = player.hand.some((c) => c.rank === '10' && c.isRed);
      player.team = hasRed10 ? 'red10' : 'black10';
    }

    // Skip doubling for now, go straight to playing
    this.state.phase = 'playing';

    // Start the first round with seat 0 (or previous game winner)
    const leaderId = this.state.previousGameWinner ?? this.state.turnOrder[0];
    this.startNewRound(leaderId);
  }

  /**
   * Start a new round with the given player as leader.
   */
  startNewRound(leaderId: string): void {
    this.state.round = {
      leaderId,
      currentPlayerId: leaderId,
      currentFormat: null,
      lastPlay: null,
      passCount: 0,
      plays: [],
      chaGoState: null,
    };
  }

  /**
   * Process a play (cards played by current player).
   */
  playCards(playerId: string, cards: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    if (round.currentPlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    if (cards.length === 0) {
      return { success: false, error: 'Must play at least one card' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Validate card ownership - match by card ID
    const handIds = new Set(player.hand.map((c) => c.id));
    for (const card of cards) {
      if (!handIds.has(card.id)) {
        return { success: false, error: `Card ${card.id} is not in your hand` };
      }
    }

    // Use the actual cards from the player's hand (don't trust client data beyond IDs)
    const playedCardIds = new Set(cards.map((c) => c.id));
    const actualCards = player.hand.filter((c) => playedCardIds.has(c.id));

    // Detect the format of the play
    const format = detectFormat(actualCards);
    if (format === null) {
      return { success: false, error: 'Invalid card combination' };
    }

    // If this is the opening play of the round (no format set yet)
    if (round.currentFormat === null) {
      // Leader sets the format - any valid format is fine
      // Create the play
      const play: Play = {
        playerId,
        cards: actualCards,
        format,
        rankValue: format === 'bomb' ? (classifyBomb(actualCards)?.rankValue ?? 0) : getPlayValue(actualCards, format),
        length: actualCards.length,
        specialBomb: format === 'bomb' ? (classifyBomb(actualCards)?.type !== 'normal' ? classifyBomb(actualCards)!.type as Play['specialBomb'] : undefined) : undefined,
        timestamp: Date.now(),
      };

      // Remove cards from hand
      player.hand = player.hand.filter((c) => !playedCardIds.has(c.id));
      player.handSize = player.hand.length;

      // Update round state
      round.currentFormat = format;
      round.lastPlay = play;
      round.plays.push(play);
      round.passCount = 0;

      // Check if player is out
      if (player.hand.length === 0) {
        this.markPlayerOut(player);
      }

      // Check if game should end
      if (this.isGameOver()) {
        return { success: true };
      }

      // Move to next player
      round.currentPlayerId = this.getNextActivePlayer(playerId);

      // If the player who just played went out and was the only active player left,
      // or if all remaining players have already passed, check round end
      this.checkRoundEnd();

      return { success: true };
    }

    // Subsequent play - must beat the current play
    if (round.lastPlay === null) {
      return { success: false, error: 'Unexpected state: format set but no last play' };
    }

    if (!canBeat(actualCards, round.lastPlay)) {
      return { success: false, error: 'Your play does not beat the current play' };
    }

    // Create the play
    const play: Play = {
      playerId,
      cards: actualCards,
      format,
      rankValue: format === 'bomb' ? (classifyBomb(actualCards)?.rankValue ?? 0) : getPlayValue(actualCards, format),
      length: actualCards.length,
      specialBomb: format === 'bomb' ? (classifyBomb(actualCards)?.type !== 'normal' ? classifyBomb(actualCards)!.type as Play['specialBomb'] : undefined) : undefined,
      timestamp: Date.now(),
    };

    // Remove cards from hand
    player.hand = player.hand.filter((c) => !playedCardIds.has(c.id));
    player.handSize = player.hand.length;

    // Update round state
    // If a bomb was played on a non-bomb round, the format changes to bomb
    if (format === 'bomb') {
      round.currentFormat = 'bomb';
    }
    round.lastPlay = play;
    round.plays.push(play);
    round.passCount = 0;

    // Check if player is out
    if (player.hand.length === 0) {
      this.markPlayerOut(player);
    }

    // Check if game should end
    if (this.isGameOver()) {
      return { success: true };
    }

    // Move to next player
    round.currentPlayerId = this.getNextActivePlayer(playerId);

    // Check if round should end (all active players passed or only one left)
    this.checkRoundEnd();

    return { success: true };
  }

  /**
   * Process a pass by the current player.
   */
  pass(playerId: string): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    if (round.currentPlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    // Leader cannot pass on opening play
    if (round.currentFormat === null && round.leaderId === playerId) {
      return { success: false, error: 'Leader must play on the opening turn' };
    }

    round.passCount++;

    // Move to next player
    round.currentPlayerId = this.getNextActivePlayer(playerId);

    // Check if round ends
    this.checkRoundEnd();

    return { success: true };
  }

  /**
   * Check if the game phase is game_over.
   */
  private isGameOver(): boolean {
    return this.state.phase === 'game_over';
  }

  /**
   * Get the next active player (skip players who are out).
   */
  private getNextActivePlayer(currentId: string): string {
    const { turnOrder } = this.state;
    const currentIndex = turnOrder.indexOf(currentId);
    const len = turnOrder.length;

    for (let i = 1; i <= len; i++) {
      const nextId = turnOrder[(currentIndex + i) % len];
      const nextPlayer = this.state.players.find((p) => p.id === nextId);
      if (nextPlayer && !nextPlayer.isOut) {
        return nextId;
      }
    }

    // Should not happen if game is still in progress
    return currentId;
  }

  /**
   * Check if the current round should end (all active players passed since last play).
   */
  private checkRoundEnd(): void {
    const round = this.state.round;
    if (!round || !round.lastPlay) return;

    const activePlayers = this.state.players.filter((p) => !p.isOut);
    // The round ends when passCount >= activePlayers - 1
    // (everyone except the last player who played has passed)
    // But we also need to account for the possibility that the last player who played went out
    const lastPlayerId = round.lastPlay.playerId;
    const lastPlayerIsOut = this.state.players.find((p) => p.id === lastPlayerId)?.isOut ?? false;

    let passesNeeded: number;
    if (lastPlayerIsOut) {
      // If the last player went out, all remaining active players must pass
      passesNeeded = activePlayers.length;
    } else {
      // Normal case: everyone except the last player who played must pass
      passesNeeded = activePlayers.length - 1;
    }

    if (round.passCount >= passesNeeded) {
      // Round is over - start a new round
      // The winner is the player who made the last play
      const winnerId = round.lastPlay.playerId;

      // If the winner is out, the next active player leads
      const winnerIsOut = this.state.players.find((p) => p.id === winnerId)?.isOut ?? false;
      let nextLeaderId: string;

      if (winnerIsOut) {
        nextLeaderId = this.getNextActivePlayer(winnerId);
      } else {
        nextLeaderId = winnerId;
      }

      // Only start a new round if there are still active players
      if (activePlayers.length >= 2 || (activePlayers.length === 1 && !lastPlayerIsOut)) {
        this.startNewRound(nextLeaderId);
      } else {
        // Game over - only 0 or 1 player left
        this.checkGameEnd();
      }
    }
  }

  /**
   * Mark a player as out and update finish order.
   */
  private markPlayerOut(player: PlayerState): void {
    player.isOut = true;
    this.state.finishOrder.push(player.id);
    player.finishOrder = this.state.finishOrder.length;

    // First player out sets the scoring team
    if (this.state.finishOrder.length === 1) {
      this.state.scoringTeam = player.team;
    }

    // Check if all players of one team are out
    this.checkGameEnd();
  }

  /**
   * Check if the game should end.
   */
  private checkGameEnd(): void {
    const activePlayers = this.state.players.filter((p) => !p.isOut);

    // Game ends when only 1 or 0 players remain
    if (activePlayers.length <= 1) {
      // Mark any remaining player as out too
      if (activePlayers.length === 1) {
        const lastPlayer = activePlayers[0];
        lastPlayer.isOut = true;
        this.state.finishOrder.push(lastPlayer.id);
        lastPlayer.finishOrder = this.state.finishOrder.length;
      }
      this.state.phase = 'game_over';
      this.state.round = null;
      return;
    }

    // Also check if all players of one team are out
    const teams = new Map<string, { out: number; total: number }>();
    for (const p of this.state.players) {
      const team = p.team ?? 'black10';
      const current = teams.get(team) ?? { out: 0, total: 0 };
      current.total++;
      if (p.isOut) current.out++;
      teams.set(team, current);
    }

    for (const [, info] of teams) {
      if (info.out === info.total) {
        // All members of this team are out - game over
        // Mark remaining players as out in current order
        const remaining = this.state.players
          .filter((p) => !p.isOut)
          .sort((a, b) => {
            // Sort by seat order for consistent finishing
            return this.state.turnOrder.indexOf(a.id) - this.state.turnOrder.indexOf(b.id);
          });
        for (const p of remaining) {
          p.isOut = true;
          this.state.finishOrder.push(p.id);
          p.finishOrder = this.state.finishOrder.length;
        }
        this.state.phase = 'game_over';
        this.state.round = null;
        return;
      }
    }
  }

  /**
   * Determine valid actions for a player.
   */
  getValidActions(playerId: string): ActionType[] {
    if (this.state.phase !== 'playing') return [];

    const round = this.state.round;
    if (!round) return [];

    if (round.currentPlayerId !== playerId) return [];

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isOut) return [];

    const actions: ActionType[] = ['play'];

    // Leader cannot pass on opening play
    if (round.currentFormat !== null || round.leaderId !== playerId) {
      actions.push('pass');
    }

    return actions;
  }

  /**
   * Get personalized view for a specific player.
   * Hides other players' hands and team info.
   */
  getClientView(playerId: string): ClientGameView {
    const me = this.state.players.find((p) => p.id === playerId);
    if (!me) {
      throw new Error(`Player ${playerId} not found in game ${this.state.id}`);
    }

    const playerViews: ClientPlayerView[] = this.state.players.map((p) => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      handSize: p.handSize,
      isOut: p.isOut,
      finishOrder: p.finishOrder,
      // Other players' teams are hidden unless revealed (revealedRed10Count > 0)
      team: p.id === playerId ? p.team : (p.revealedRed10Count > 0 ? p.team : null),
      revealedRed10Count: p.revealedRed10Count,
      isConnected: p.isConnected,
    }));

    const myTeam: Team = me.team ?? 'black10';

    const isMyTurn =
      this.state.phase === 'playing' &&
      this.state.round?.currentPlayerId === playerId &&
      !me.isOut;

    const validActions = this.getValidActions(playerId);

    return {
      gameId: this.state.id,
      phase: this.state.phase,
      myHand: me.hand,
      players: playerViews,
      round: this.state.round,
      doubling: this.state.doubling,
      stakeMultiplier: this.state.stakeMultiplier,
      isMyTurn,
      validActions,
      myTeam,
      finishOrder: this.state.finishOrder,
      scoringTeam: this.state.scoringTeam,
    };
  }

  /**
   * Get full server-side state.
   */
  getState(): GameState {
    return this.state;
  }
}
