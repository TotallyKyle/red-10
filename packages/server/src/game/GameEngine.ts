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
  BombInfo,
  SpecialBombType,
  Rank,
  ChaGoState,
} from '@red10/shared';
import { detectFormat, canBeat, getPlayValue, classifyBomb, rankValue, isRedTen, isBlackTen, isValidDefuse, defuseResultFormat, PLAYER_COUNT, COPIES_PER_RANK } from '@red10/shared';
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

    // During cha-go waiting_go phase, validate the card is a single of the trigger rank
    if (round.chaGoState && round.chaGoState.phase === 'waiting_go') {
      if (actualCards.length !== 1 || actualCards[0].rank !== round.chaGoState.triggerRank) {
        return { success: false, error: `During cha-go, must play a single ${round.chaGoState.triggerRank}` };
      }
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

      // Check if any played cards are red 10s — reveal team
      this.checkRedTenReveal(player, actualCards);

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

      // Check for cha-go opportunity after a single card play in a singles round
      if (format === 'single' && this.checkChaGoOpportunity(actualCards[0], playerId)) {
        // Cha-go mode activated — don't advance turn normally
        return { success: true };
      }

      // Move to next player
      round.currentPlayerId = this.getNextActivePlayer(playerId);

      // If the player who just played went out and was the only active player left,
      // or if all remaining players have already passed, check round end
      this.checkRoundEnd();

      return { success: true };
    }

    // Subsequent play - must beat the current play (unless in cha-go waiting_go)
    if (round.lastPlay === null) {
      return { success: false, error: 'Unexpected state: format set but no last play' };
    }

    // During waiting_go, we already validated above; skip canBeat check
    if (!round.chaGoState || round.chaGoState.phase !== 'waiting_go') {
      if (!canBeat(actualCards, round.lastPlay)) {
        return { success: false, error: 'Your play does not beat the current play' };
      }
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

    // Check if any played cards are red 10s — reveal team
    this.checkRedTenReveal(player, actualCards);

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

    // Handle cha-go waiting_go: after go is played, transition to waiting_final_cha
    if (round.chaGoState && round.chaGoState.phase === 'waiting_go') {
      round.chaGoState.goPlayerId = playerId;
      round.chaGoState.remainingCopies = this.countRemainingCopies(round.chaGoState.triggerRank);
      // Check if anyone can do the final cha (pair of trigger rank)
      const finalChaEligible = this.getEligibleChaPlayers(round.chaGoState.triggerRank, playerId);
      if (finalChaEligible.length > 0) {
        round.chaGoState.phase = 'waiting_final_cha';
        round.chaGoState.eligiblePlayerIds = finalChaEligible;
        round.chaGoState.declinedPlayerIds = [];
        // Don't advance turn normally — cha-go sub-state handles it
        return { success: true };
      } else {
        // No one can final cha — go player wins the round
        this.endChaGoRound(playerId);
        return { success: true };
      }
    }

    // Check for cha-go opportunity after a single card play in a singles round
    if (format === 'single' && round.currentFormat === 'single' && !round.chaGoState) {
      if (this.checkChaGoOpportunity(actualCards[0], playerId)) {
        return { success: true };
      }
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

    // During cha-go waiting_go phase, pass works within cha-go turn order
    if (round.chaGoState && round.chaGoState.phase === 'waiting_go') {
      if (round.currentPlayerId !== playerId) {
        return { success: false, error: 'Not your turn' };
      }
      round.passCount++;
      // Check if all active players (except the cha player) have passed
      const activePlayers = this.state.players.filter((p) => !p.isOut);
      const chaPlayer = round.chaGoState.chaPlayerId;
      const chaPlayerIsOut = this.state.players.find((p) => p.id === chaPlayer)?.isOut ?? false;
      let passesNeeded: number;
      if (chaPlayerIsOut) {
        passesNeeded = activePlayers.length;
      } else {
        passesNeeded = activePlayers.length - 1;
      }
      if (round.passCount >= passesNeeded) {
        // Everyone passed on go — cha player wins the round
        this.endChaGoRound(chaPlayer!);
        return { success: true };
      }
      // Advance to next active player
      round.currentPlayerId = this.getNextActivePlayer(playerId);
      return { success: true };
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

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isOut) return [];

    // ---- Cha-Go phases ----
    if (round.chaGoState) {
      const cg = round.chaGoState;
      const triggerRank = cg.triggerRank;
      const copiesInHand = player.hand.filter((c) => c.rank === triggerRank).length;

      if (cg.phase === 'waiting_cha') {
        // Only eligible players who haven't declined can cha
        if (cg.eligiblePlayerIds.includes(playerId) && !cg.declinedPlayerIds.includes(playerId)) {
          const actions: ActionType[] = ['decline_cha'];
          if (copiesInHand >= 2) {
            actions.unshift('cha');
          }
          if (copiesInHand >= 3) {
            actions.unshift('go_cha');
          }
          return actions;
        }
        return [];
      }

      if (cg.phase === 'waiting_go') {
        if (round.currentPlayerId === playerId) {
          const actions: ActionType[] = ['pass'];
          if (copiesInHand >= 1) {
            actions.unshift('play');
          }
          if (copiesInHand >= 3) {
            actions.unshift('go_cha');
          }
          return actions;
        }
        return [];
      }

      if (cg.phase === 'waiting_final_cha') {
        if (cg.eligiblePlayerIds.includes(playerId) && !cg.declinedPlayerIds.includes(playerId)) {
          const actions: ActionType[] = ['decline_cha'];
          if (copiesInHand >= 2) {
            actions.unshift('cha');
          }
          if (copiesInHand >= 3) {
            actions.unshift('go_cha');
          }
          return actions;
        }
        return [];
      }
    }

    // Defuse can be done by any player (interrupt), not just current turn player
    // Check if the last play was a red 10 special bomb and this player can defuse
    if (round.lastPlay?.specialBomb === 'red10_2' || round.lastPlay?.specialBomb === 'red10_3') {
      const neededBlack10s = round.lastPlay.specialBomb === 'red10_2' ? 2 : 3;
      const black10Count = player.hand.filter((c) => isBlackTen(c)).length;
      if (black10Count >= neededBlack10s) {
        // Player can defuse — this is available even when it's not their turn
        const actions: ActionType[] = ['defuse'];
        // If it's also their turn, they can play/pass normally too
        if (round.currentPlayerId === playerId) {
          actions.push('play');
          if (round.currentFormat !== null || round.leaderId !== playerId) {
            actions.push('pass');
          }
        }
        return actions;
      }
    }

    if (round.currentPlayerId !== playerId) return [];

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
   * Process a defuse attempt against a red 10 special bomb.
   */
  defuse(playerId: string, cards: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    const lastPlay = round.lastPlay;
    if (!lastPlay) {
      return { success: false, error: 'No play to defuse' };
    }

    // Only red 10 special bombs can be defused
    if (!lastPlay.specialBomb || (lastPlay.specialBomb !== 'red10_2' && lastPlay.specialBomb !== 'red10_3')) {
      return { success: false, error: 'Only red 10 bombs can be defused' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (player.isOut) {
      return { success: false, error: 'Player is out' };
    }

    // Validate card ownership
    const handIds = new Set(player.hand.map((c) => c.id));
    for (const card of cards) {
      if (!handIds.has(card.id)) {
        return { success: false, error: `Card ${card.id} is not in your hand` };
      }
    }

    // Use actual cards from hand
    const playedCardIds = new Set(cards.map((c) => c.id));
    const actualCards = player.hand.filter((c) => playedCardIds.has(c.id));

    // Classify the bomb being defused
    const bombInfo = classifyBomb(lastPlay.cards);
    if (!bombInfo) {
      return { success: false, error: 'Last play is not a valid bomb' };
    }

    // Validate the defuse
    if (!isValidDefuse(actualCards, bombInfo)) {
      return { success: false, error: 'Invalid defuse: need matching number of black 10s' };
    }

    // Remove black 10s from defuser's hand
    player.hand = player.hand.filter((c) => !playedCardIds.has(c.id));
    player.handSize = player.hand.length;

    // Determine what format the round continues as
    const newFormat = defuseResultFormat(lastPlay.specialBomb);

    // The defuse cards become the current play
    const defusePlay: Play = {
      playerId,
      cards: actualCards,
      format: newFormat,
      rankValue: newFormat === 'bomb'
        ? (classifyBomb(actualCards)?.rankValue ?? rankValue('10'))
        : getPlayValue(actualCards, newFormat),
      length: actualCards.length,
      specialBomb: undefined,
      timestamp: Date.now(),
    };

    round.currentFormat = newFormat;
    round.lastPlay = defusePlay;
    round.plays.push(defusePlay);
    round.passCount = 0;

    // Check if player is out
    if (player.hand.length === 0) {
      this.markPlayerOut(player);
    }

    if (this.isGameOver()) {
      return { success: true };
    }

    // Continue from the defuser in turn order
    round.currentPlayerId = this.getNextActivePlayer(playerId);

    this.checkRoundEnd();

    return { success: true };
  }

  // ---- Cha-Go methods ----

  /**
   * Count how many copies of a rank are still in players' hands.
   */
  private countRemainingCopies(rank: Rank): number {
    let count = 0;
    for (const p of this.state.players) {
      count += p.hand.filter((c) => c.rank === rank).length;
    }
    return count;
  }

  /**
   * Get player IDs (other than excludePlayerId) who have 2+ copies of rank in hand.
   */
  private getEligibleChaPlayers(rank: Rank, excludePlayerId: string): string[] {
    const eligible: string[] = [];
    for (const p of this.state.players) {
      if (p.id === excludePlayerId || p.isOut) continue;
      const copies = p.hand.filter((c) => c.rank === rank).length;
      if (copies >= 2) {
        eligible.push(p.id);
      }
    }
    return eligible;
  }

  /**
   * Called after a single is played — checks if cha-go is possible.
   * Returns true if cha-go was activated.
   */
  private checkChaGoOpportunity(playedCard: Card, playerId: string): boolean {
    const round = this.state.round;
    if (!round) return false;

    const rank = playedCard.rank;
    const eligible = this.getEligibleChaPlayers(rank, playerId);

    if (eligible.length === 0) {
      return false;
    }

    // Activate cha-go
    round.chaGoState = {
      triggerRank: rank,
      phase: 'waiting_cha',
      chaPlayerId: null,
      goPlayerId: null,
      eligiblePlayerIds: eligible,
      declinedPlayerIds: [],
      remainingCopies: this.countRemainingCopies(rank),
    };

    return true;
  }

  /**
   * Player plays a cha (pair of the trigger rank).
   */
  cha(playerId: string, cards: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    const cg = round.chaGoState;
    if (!cg) {
      return { success: false, error: 'Not in cha-go state' };
    }

    if (cg.phase !== 'waiting_cha' && cg.phase !== 'waiting_final_cha') {
      return { success: false, error: 'Not waiting for cha' };
    }

    if (!cg.eligiblePlayerIds.includes(playerId)) {
      return { success: false, error: 'You are not eligible to cha' };
    }

    if (cg.declinedPlayerIds.includes(playerId)) {
      return { success: false, error: 'You already declined' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isOut) {
      return { success: false, error: 'Player not found or is out' };
    }

    // Validate card ownership
    const handIds = new Set(player.hand.map((c) => c.id));
    for (const card of cards) {
      if (!handIds.has(card.id)) {
        return { success: false, error: `Card ${card.id} is not in your hand` };
      }
    }

    // Use actual cards from hand
    const playedCardIds = new Set(cards.map((c) => c.id));
    const actualCards = player.hand.filter((c) => playedCardIds.has(c.id));

    // Must be exactly 2 cards of the trigger rank
    if (actualCards.length !== 2) {
      return { success: false, error: 'Cha requires exactly 2 cards' };
    }

    if (!actualCards.every((c) => c.rank === cg.triggerRank)) {
      return { success: false, error: `Cha cards must be of rank ${cg.triggerRank}` };
    }

    // Remove cards from hand
    player.hand = player.hand.filter((c) => !playedCardIds.has(c.id));
    player.handSize = player.hand.length;

    // Check red 10 reveal
    this.checkRedTenReveal(player, actualCards);

    // Create the play
    const play: Play = {
      playerId,
      cards: actualCards,
      format: 'pair',
      rankValue: getPlayValue(actualCards, 'pair'),
      length: 2,
      timestamp: Date.now(),
    };

    round.lastPlay = play;
    round.plays.push(play);
    round.passCount = 0;

    // Check if player is out
    if (player.hand.length === 0) {
      this.markPlayerOut(player);
    }

    if (this.isGameOver()) {
      round.chaGoState = null;
      return { success: true };
    }

    if (cg.phase === 'waiting_final_cha') {
      // Final cha — this player wins the round
      this.endChaGoRound(playerId);
      return { success: true };
    }

    // First cha — transition to waiting_go
    cg.chaPlayerId = playerId;
    cg.phase = 'waiting_go';
    cg.eligiblePlayerIds = [];
    cg.declinedPlayerIds = [];
    cg.remainingCopies = this.countRemainingCopies(cg.triggerRank);

    // Play continues clockwise from the cha player
    round.currentPlayerId = this.getNextActivePlayer(playerId);

    return { success: true };
  }

  /**
   * Player plays a go-cha (3 of the trigger rank, auto-wins).
   */
  goCha(playerId: string, cards: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    const cg = round.chaGoState;
    if (!cg) {
      return { success: false, error: 'Not in cha-go state' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isOut) {
      return { success: false, error: 'Player not found or is out' };
    }

    // Go-cha can happen during any cha-go phase
    // During waiting_cha / waiting_final_cha: eligible players can go-cha
    // During waiting_go: the current turn player can go-cha
    if (cg.phase === 'waiting_cha' || cg.phase === 'waiting_final_cha') {
      if (!cg.eligiblePlayerIds.includes(playerId) || cg.declinedPlayerIds.includes(playerId)) {
        return { success: false, error: 'You are not eligible for go-cha' };
      }
    } else if (cg.phase === 'waiting_go') {
      if (round.currentPlayerId !== playerId) {
        return { success: false, error: 'Not your turn for go-cha' };
      }
    }

    // Validate card ownership
    const handIds = new Set(player.hand.map((c) => c.id));
    for (const card of cards) {
      if (!handIds.has(card.id)) {
        return { success: false, error: `Card ${card.id} is not in your hand` };
      }
    }

    const playedCardIds = new Set(cards.map((c) => c.id));
    const actualCards = player.hand.filter((c) => playedCardIds.has(c.id));

    // Must be exactly 3 cards of the trigger rank
    if (actualCards.length !== 3) {
      return { success: false, error: 'Go-cha requires exactly 3 cards' };
    }

    if (!actualCards.every((c) => c.rank === cg.triggerRank)) {
      return { success: false, error: `Go-cha cards must be of rank ${cg.triggerRank}` };
    }

    // Remove cards from hand
    player.hand = player.hand.filter((c) => !playedCardIds.has(c.id));
    player.handSize = player.hand.length;

    this.checkRedTenReveal(player, actualCards);

    // Create the play
    const play: Play = {
      playerId,
      cards: actualCards,
      format: 'single', // stays as single format for the round
      rankValue: getPlayValue([actualCards[0]], 'single'),
      length: 3,
      timestamp: Date.now(),
    };

    round.lastPlay = play;
    round.plays.push(play);

    // Check if player is out
    if (player.hand.length === 0) {
      this.markPlayerOut(player);
    }

    if (this.isGameOver()) {
      round.chaGoState = null;
      return { success: true };
    }

    // Go-cha auto-wins the round
    this.endChaGoRound(playerId);

    return { success: true };
  }

  /**
   * Player declines to cha.
   */
  declineCha(playerId: string): { success: boolean; error?: string } {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const round = this.state.round;
    if (!round) {
      return { success: false, error: 'No active round' };
    }

    const cg = round.chaGoState;
    if (!cg) {
      return { success: false, error: 'Not in cha-go state' };
    }

    if (cg.phase !== 'waiting_cha' && cg.phase !== 'waiting_final_cha') {
      return { success: false, error: 'Not waiting for cha' };
    }

    if (!cg.eligiblePlayerIds.includes(playerId)) {
      return { success: false, error: 'You are not eligible to cha' };
    }

    if (cg.declinedPlayerIds.includes(playerId)) {
      return { success: false, error: 'You already declined' };
    }

    cg.declinedPlayerIds.push(playerId);

    // Check if all eligible players have declined
    if (cg.declinedPlayerIds.length >= cg.eligiblePlayerIds.length) {
      if (cg.phase === 'waiting_cha') {
        // Nobody cha'd — normal play resumes. The single stands.
        round.chaGoState = null;
        // Advance to next player after the one who played the single
        const lastPlayerId = round.lastPlay!.playerId;
        round.currentPlayerId = this.getNextActivePlayer(lastPlayerId);
        this.checkRoundEnd();
      } else {
        // waiting_final_cha — nobody did final cha, go player wins
        this.endChaGoRound(cg.goPlayerId!);
      }
    }

    return { success: true };
  }

  /**
   * End a cha-go round. The winner gets to lead the next round.
   */
  private endChaGoRound(winnerId: string): void {
    const round = this.state.round;
    if (!round) return;

    round.chaGoState = null;

    const winnerIsOut = this.state.players.find((p) => p.id === winnerId)?.isOut ?? false;
    const activePlayers = this.state.players.filter((p) => !p.isOut);

    let nextLeaderId: string;
    if (winnerIsOut) {
      nextLeaderId = this.getNextActivePlayer(winnerId);
    } else {
      nextLeaderId = winnerId;
    }

    if (activePlayers.length >= 2 || (activePlayers.length === 1 && !winnerIsOut)) {
      this.startNewRound(nextLeaderId);
    } else {
      this.checkGameEnd();
    }
  }

  /**
   * Check if played cards contain red 10s and update the player's reveal state.
   */
  private checkRedTenReveal(player: PlayerState, playedCards: Card[]): void {
    const red10Count = playedCards.filter((c) => isRedTen(c)).length;
    if (red10Count > 0) {
      player.revealedRed10Count += red10Count;
    }
  }

  /**
   * Get full server-side state.
   */
  getState(): GameState {
    return this.state;
  }
}
