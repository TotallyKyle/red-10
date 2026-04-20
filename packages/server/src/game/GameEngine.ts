import type {
  GameState,
  GameResult,
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
  DoublingState,
  RevealedBomb,
} from '@red10/shared';
import { detectFormat, canBeat, getPlayValue, classifyBomb, rankValue, isRedTen, isBlackTen, isValidDefuse, defuseResultFormat, PLAYER_COUNT, COPIES_PER_RANK } from '@red10/shared';
import { createDeck, shuffle, deal } from './Deck.js';
import { calculateScore } from './Scoring.js';

interface PlayerInit {
  id: string;
  name: string;
  seatIndex: number;
}

export class GameEngine {
  private state: GameState;
  /** Turn order for the doubling phase */
  private doublingTurnOrder: string[] = [];
  /** Current index into doublingTurnOrder */
  private doublingTurnIndex = 0;
  /** Players who have already skipped quadruple */
  private quadrupleSkipped: Set<string> = new Set();
  /** Calculated game result after game ends */
  private gameResult: GameResult | null = null;
  /** Player IDs who want to play again */
  private playAgainPlayerIds: Set<string> = new Set();

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

    // Enter doubling phase
    this.state.phase = 'doubling';

    // Build doubling turn order starting from previous winner (or seat 0)
    const starterId = this.state.previousGameWinner ?? this.state.turnOrder[0];
    const starterIdx = this.state.turnOrder.indexOf(starterId);
    const doublingOrder: string[] = [];
    for (let i = 0; i < this.state.turnOrder.length; i++) {
      doublingOrder.push(this.state.turnOrder[(starterIdx + i) % this.state.turnOrder.length]);
    }
    this.doublingTurnOrder = doublingOrder;
    this.doublingTurnIndex = 0;

    this.state.doubling = {
      currentBidderId: doublingOrder[0],
      isDoubled: false,
      isQuadrupled: false,
      doublerTeam: null,
      revealedBombs: [],
      teamsRevealed: false,
    };
  }

  /**
   * End the doubling phase and transition to playing.
   */
  private endDoublingPhase(): void {
    this.state.phase = 'playing';
    // Keep doubling state for teamsRevealed / revealedBombs visibility;
    // clear the currentBidderId since the phase is over.
    if (this.state.doubling) {
      this.state.doubling.currentBidderId = '';
    }
    const leaderId = this.state.previousGameWinner ?? this.state.turnOrder[0];
    this.startNewRound(leaderId);
  }

  /**
   * Player declares double during the doubling phase.
   * bombCards is required for black 10 team members.
   */
  declareDouble(playerId: string, bombCards?: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'doubling' || !this.state.doubling) {
      return { success: false, error: 'Not in doubling phase' };
    }

    const doubling = this.state.doubling;
    if (doubling.isDoubled) {
      return { success: false, error: 'Already doubled' };
    }

    if (doubling.currentBidderId !== playerId) {
      return { success: false, error: 'Not your turn to bid' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    const team = player.team!;

    if (team === 'black10') {
      // Black 10 team member must reveal a bomb
      if (!bombCards || bombCards.length === 0) {
        return { success: false, error: 'Black 10 team member must reveal a bomb to double' };
      }

      // Validate card ownership using IDs
      const handIds = new Set(player.hand.map((c) => c.id));
      for (const card of bombCards) {
        if (!handIds.has(card.id)) {
          return { success: false, error: `Card ${card.id} is not in your hand` };
        }
      }

      // Use actual cards from hand
      const bombCardIds = new Set(bombCards.map((c) => c.id));
      const actualBombCards = player.hand.filter((c) => bombCardIds.has(c.id));

      // Validate the cards form a valid bomb
      const bombInfo = classifyBomb(actualBombCards);
      if (!bombInfo) {
        return { success: false, error: 'Cards do not form a valid bomb' };
      }

      // Record the revealed bomb
      doubling.revealedBombs.push({ playerId, cards: actualBombCards });
    } else {
      // Red 10 team member: auto-reveal all their red 10s
      const red10Count = player.hand.filter((c) => isRedTen(c)).length;
      player.revealedRed10Count = red10Count;
    }

    // Set doubled state
    doubling.isDoubled = true;
    doubling.doublerTeam = team;
    this.state.stakeMultiplier = 2;

    // Force ALL red 10 holders to reveal their red 10s
    for (const p of this.state.players) {
      const red10Count = p.hand.filter((c) => isRedTen(c)).length;
      if (red10Count > 0) {
        p.revealedRed10Count = red10Count;
      }
    }
    doubling.teamsRevealed = true;

    // Set up quadruple opportunity for the opposing team
    const opposingTeam: Team = team === 'red10' ? 'black10' : 'red10';
    // Find the first opposing team member in doubling turn order
    const opposingMember = this.doublingTurnOrder.find(
      (id) => this.state.players.find((p) => p.id === id)?.team === opposingTeam,
    );

    if (opposingMember) {
      doubling.currentBidderId = opposingMember;
    } else {
      // No opposing team member found (shouldn't happen), end phase
      this.endDoublingPhase();
    }

    return { success: true };
  }

  /**
   * Player skips their doubling turn.
   */
  skipDouble(playerId: string): { success: boolean; error?: string } {
    if (this.state.phase !== 'doubling' || !this.state.doubling) {
      return { success: false, error: 'Not in doubling phase' };
    }

    const doubling = this.state.doubling;

    if (doubling.currentBidderId !== playerId) {
      return { success: false, error: 'Not your turn to bid' };
    }

    // If we're in the quadruple phase (isDoubled is true), use skipQuadruple logic
    if (doubling.isDoubled) {
      return this.skipQuadruple(playerId);
    }

    // Advance to next player in doubling turn order
    this.doublingTurnIndex++;
    if (this.doublingTurnIndex >= this.doublingTurnOrder.length) {
      // All players have had a chance, nobody doubled
      this.endDoublingPhase();
    } else {
      doubling.currentBidderId = this.doublingTurnOrder[this.doublingTurnIndex];
    }

    return { success: true };
  }

  /**
   * Opposing team declares quadruple in response to a double.
   */
  declareQuadruple(playerId: string, bombCards?: Card[]): { success: boolean; error?: string } {
    if (this.state.phase !== 'doubling' || !this.state.doubling) {
      return { success: false, error: 'Not in doubling phase' };
    }

    const doubling = this.state.doubling;
    if (!doubling.isDoubled) {
      return { success: false, error: 'No double has been declared' };
    }

    if (doubling.isQuadrupled) {
      return { success: false, error: 'Already quadrupled' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Must be on the opposing team of the doubler
    if (player.team === doubling.doublerTeam) {
      return { success: false, error: 'Only the opposing team can quadruple' };
    }

    if (player.team === 'black10') {
      // Black 10 team must reveal a bomb to quadruple
      if (!bombCards || bombCards.length === 0) {
        return { success: false, error: 'Black 10 team must reveal a bomb to quadruple' };
      }

      const handIds = new Set(player.hand.map((c) => c.id));
      for (const card of bombCards) {
        if (!handIds.has(card.id)) {
          return { success: false, error: `Card ${card.id} is not in your hand` };
        }
      }

      const bombCardIds = new Set(bombCards.map((c) => c.id));
      const actualBombCards = player.hand.filter((c) => bombCardIds.has(c.id));

      const bombInfo = classifyBomb(actualBombCards);
      if (!bombInfo) {
        return { success: false, error: 'Cards do not form a valid bomb' };
      }

      doubling.revealedBombs.push({ playerId, cards: actualBombCards });
    }
    // Red 10 team: no bomb needed, their red 10s are already revealed from the double

    doubling.isQuadrupled = true;
    this.state.stakeMultiplier = 4;

    // End doubling phase
    this.endDoublingPhase();

    return { success: true };
  }

  /**
   * Opposing team member skips quadruple.
   */
  skipQuadruple(playerId: string): { success: boolean; error?: string } {
    if (this.state.phase !== 'doubling' || !this.state.doubling) {
      return { success: false, error: 'Not in doubling phase' };
    }

    const doubling = this.state.doubling;
    if (!doubling.isDoubled) {
      return { success: false, error: 'No double has been declared' };
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (player.team === doubling.doublerTeam) {
      return { success: false, error: 'Only the opposing team can respond to double' };
    }

    if (doubling.currentBidderId !== playerId) {
      return { success: false, error: 'Not your turn to bid' };
    }

    this.quadrupleSkipped.add(playerId);

    // Find next opposing team member in doubling turn order who hasn't skipped
    const opposingTeam: Team = doubling.doublerTeam === 'red10' ? 'black10' : 'red10';
    const currentIdx = this.doublingTurnOrder.indexOf(playerId);
    let found = false;

    for (let i = 1; i < this.doublingTurnOrder.length; i++) {
      const nextId = this.doublingTurnOrder[(currentIdx + i) % this.doublingTurnOrder.length];
      const nextPlayer = this.state.players.find((p) => p.id === nextId);
      if (nextPlayer?.team === opposingTeam && !this.quadrupleSkipped.has(nextId)) {
        doubling.currentBidderId = nextId;
        found = true;
        break;
      }
    }

    if (!found) {
      // All opposing team members have skipped
      this.endDoublingPhase();
    }

    return { success: true };
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
      this.gameResult = calculateScore(this.state);
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
        this.gameResult = calculateScore(this.state);
        return;
      }
    }
  }

  /**
   * Determine valid actions for a player.
   */
  getValidActions(playerId: string): ActionType[] {
    // Handle doubling phase
    if (this.state.phase === 'doubling' && this.state.doubling) {
      const doubling = this.state.doubling;
      if (doubling.currentBidderId !== playerId) return [];

      if (doubling.isDoubled) {
        // Quadruple phase: opposing team can quadruple or skip
        const player = this.state.players.find((p) => p.id === playerId);
        if (!player || player.team === doubling.doublerTeam) return [];
        return ['quadruple', 'skip_double'];
      }

      // Normal doubling turn
      return ['double', 'skip_double'];
    }

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
        // Only eligible players who haven't declined can cha.
        // Go-cha is NOT valid here — it requires a prior paired cha (which
        // transitions the state to waiting_go / waiting_final_cha). A 3-of-a-kind
        // played as the very first response to a single is not a valid go-cha.
        if (cg.eligiblePlayerIds.includes(playerId) && !cg.declinedPlayerIds.includes(playerId)) {
          const actions: ActionType[] = ['decline_cha'];
          if (copiesInHand >= 2) {
            actions.unshift('cha');
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

    const teamsRevealed = this.state.doubling?.teamsRevealed ?? false;
    const playerViews: ClientPlayerView[] = this.state.players.map((p) => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      handSize: p.handSize,
      isOut: p.isOut,
      finishOrder: p.finishOrder,
      // Other players' teams are hidden unless revealed (revealedRed10Count > 0 or teamsRevealed via doubling)
      team: p.id === playerId ? p.team : (teamsRevealed || p.revealedRed10Count > 0 ? p.team : null),
      revealedRed10Count: p.revealedRed10Count,
      isConnected: p.isConnected,
    }));

    const myTeam: Team = me.team ?? 'black10';

    const isMyTurn =
      (this.state.phase === 'playing' &&
        this.state.round?.currentPlayerId === playerId &&
        !me.isOut) ||
      (this.state.phase === 'doubling' &&
        this.state.doubling?.currentBidderId === playerId);

    const validActions = this.getValidActions(playerId);

    // Hide cha-go state during `waiting_cha` from players who are not eligible
    // to cha. Otherwise, the "Cha-Go: [rank]" indicator would leak the fact
    // that someone has a pair of that rank — critical hidden information.
    //
    // Once a cha is actually played, the cha pair appears in `round.plays` and
    // cha-go becomes public knowledge, so later phases (waiting_go and
    // waiting_final_cha) don't need hiding.
    //
    // We also advance `currentPlayerId` to the next active player for the
    // non-eligible view so the UI doesn't get stuck showing the single-player
    // as the "current turn" indefinitely, which would itself be a tell. And we
    // force `isMyTurn` to false since the actual game is paused — if the
    // non-eligible viewer happens to match the virtual next player, they
    // shouldn't see active-turn UI while cha-go is still resolving.
    let roundView = this.state.round;
    let isMyTurnView = isMyTurn;
    if (
      roundView?.chaGoState?.phase === 'waiting_cha' &&
      !roundView.chaGoState.eligiblePlayerIds.includes(playerId)
    ) {
      const lastPlayerId = roundView.lastPlay?.playerId ?? roundView.currentPlayerId;
      const virtualNextPlayer = this.getNextActivePlayer(lastPlayerId);
      roundView = { ...roundView, chaGoState: null, currentPlayerId: virtualNextPlayer };
      isMyTurnView = false;
    }

    const view: ClientGameView = {
      gameId: this.state.id,
      phase: this.state.phase,
      myHand: me.hand,
      players: playerViews,
      round: roundView,
      doubling: this.state.doubling,
      stakeMultiplier: this.state.stakeMultiplier,
      isMyTurn: isMyTurnView,
      validActions,
      myTeam,
      finishOrder: this.state.finishOrder,
      scoringTeam: this.state.scoringTeam,
    };

    if (this.gameResult) {
      view.gameResult = this.gameResult;
    }

    if (this.state.phase === 'game_over') {
      view.playAgainCount = this.playAgainPlayerIds.size;
    }

    return view;
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

    // Go-cha is only valid AFTER a paired cha has been played.
    // That means the state must already be in waiting_go (someone chas, we go-cha
    // as the single-player) or waiting_final_cha (someone chas, someone goes,
    // then we final-go-cha). It is NOT valid in waiting_cha — you must do a
    // paired cha first, not go-cha a normal single.
    if (cg.phase === 'waiting_cha') {
      return { success: false, error: 'Go-cha requires a prior paired cha — cha with a pair first' };
    }
    if (cg.phase === 'waiting_final_cha') {
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
   * Get the game result (only available after game_over).
   */
  getGameResult(): GameResult | null {
    return this.gameResult;
  }

  /**
   * Player wants to play again. Returns whether all players are ready.
   */
  playAgain(playerId: string): { allReady: boolean; count: number } {
    if (this.state.phase !== 'game_over') {
      return { allReady: false, count: 0 };
    }

    this.playAgainPlayerIds.add(playerId);
    const count = this.playAgainPlayerIds.size;
    const totalPlayers = this.state.players.length;

    if (count >= totalPlayers) {
      // All players ready — reset for a new game
      this.resetForNewGame();
      return { allReady: true, count };
    }

    return { allReady: false, count };
  }

  /**
   * Reset the game state for a new round, keeping the same players.
   */
  private resetForNewGame(): void {
    // Determine who goes first: the winner of the previous game (first in finishOrder)
    const previousWinner = this.state.finishOrder.length > 0
      ? this.state.finishOrder[0]
      : this.state.turnOrder[0];

    // Deal new cards
    const deck = shuffle(createDeck());
    const hands = deal(deck);

    // Sort players by seatIndex to assign hands in seat order
    const sortedPlayers = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);

    for (let i = 0; i < sortedPlayers.length; i++) {
      const player = this.state.players.find((p) => p.id === sortedPlayers[i].id)!;
      player.hand = hands[i];
      player.handSize = hands[i].length;
      player.isOut = false;
      player.finishOrder = null;
      player.revealedRed10Count = 0;

      // Reassign teams based on new red 10 ownership
      const hasRed10 = player.hand.some((c) => c.rank === '10' && c.isRed);
      player.team = hasRed10 ? 'red10' : 'black10';
    }

    // Reset game-level state
    this.state.finishOrder = [];
    this.state.scoringTeam = null;
    this.state.stakeMultiplier = 1;
    this.state.round = null;
    this.state.previousGameWinner = previousWinner;
    this.gameResult = null;
    this.playAgainPlayerIds.clear();
    this.quadrupleSkipped.clear();

    // Enter doubling phase
    this.state.phase = 'doubling';

    // Build doubling turn order starting from previous winner
    const starterId = previousWinner;
    const starterIdx = this.state.turnOrder.indexOf(starterId);
    const doublingOrder: string[] = [];
    for (let i = 0; i < this.state.turnOrder.length; i++) {
      doublingOrder.push(this.state.turnOrder[(starterIdx + i) % this.state.turnOrder.length]);
    }
    this.doublingTurnOrder = doublingOrder;
    this.doublingTurnIndex = 0;

    this.state.doubling = {
      currentBidderId: doublingOrder[0],
      isDoubled: false,
      isQuadrupled: false,
      doublerTeam: null,
      revealedBombs: [],
      teamsRevealed: false,
    };
  }

  /**
   * Get full server-side state.
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * Update a player's socket ID after reconnection.
   * Also restores their isConnected status.
   */
  updatePlayerId(oldId: string, newId: string): boolean {
    const player = this.state.players.find((p) => p.id === oldId);
    if (!player) return false;

    player.id = newId;
    player.isConnected = true;

    // Update all references to the old ID
    this.state.turnOrder = this.state.turnOrder.map((id) => (id === oldId ? newId : id));
    this.state.finishOrder = this.state.finishOrder.map((id) => (id === oldId ? newId : id));

    if (this.state.round) {
      if (this.state.round.leaderId === oldId) this.state.round.leaderId = newId;
      if (this.state.round.currentPlayerId === oldId) this.state.round.currentPlayerId = newId;
      for (const play of this.state.round.plays) {
        if (play.playerId === oldId) play.playerId = newId;
      }
      if (this.state.round.lastPlay?.playerId === oldId) {
        this.state.round.lastPlay.playerId = newId;
      }
      if (this.state.round.chaGoState) {
        const cg = this.state.round.chaGoState;
        if (cg.chaPlayerId === oldId) cg.chaPlayerId = newId;
        if (cg.goPlayerId === oldId) cg.goPlayerId = newId;
        cg.eligiblePlayerIds = cg.eligiblePlayerIds.map((id) => (id === oldId ? newId : id));
        cg.declinedPlayerIds = cg.declinedPlayerIds.map((id) => (id === oldId ? newId : id));
      }
    }

    if (this.state.doubling) {
      if (this.state.doubling.currentBidderId === oldId) this.state.doubling.currentBidderId = newId;
      for (const bomb of this.state.doubling.revealedBombs) {
        if (bomb.playerId === oldId) bomb.playerId = newId;
      }
    }

    if (this.state.previousGameWinner === oldId) {
      this.state.previousGameWinner = newId;
    }

    // Update doubling turn order
    this.doublingTurnOrder = this.doublingTurnOrder.map((id) => (id === oldId ? newId : id));

    // Update play again set
    if (this.playAgainPlayerIds.has(oldId)) {
      this.playAgainPlayerIds.delete(oldId);
      this.playAgainPlayerIds.add(newId);
    }

    // Update quadruple skipped set
    if (this.quadrupleSkipped.has(oldId)) {
      this.quadrupleSkipped.delete(oldId);
      this.quadrupleSkipped.add(newId);
    }

    // Update game result payouts
    if (this.gameResult?.payouts[oldId] !== undefined) {
      this.gameResult.payouts[newId] = this.gameResult.payouts[oldId];
      delete this.gameResult.payouts[oldId];
    }
    if (this.gameResult?.trapped.includes(oldId)) {
      this.gameResult.trapped = this.gameResult.trapped.map((id) => (id === oldId ? newId : id));
    }

    return true;
  }

  /**
   * Mark a player as disconnected.
   */
  setPlayerDisconnected(playerId: string): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (player) {
      player.isConnected = false;
    }
  }

  /**
   * Set up a turn timer. Returns a cleanup function.
   * If the player doesn't act within timeoutMs, auto-passes.
   */
  setupTurnTimer(timeoutMs: number, onAutoPass: (playerId: string) => void): (() => void) | null {
    if (this.state.phase !== 'playing' || !this.state.round) return null;
    const currentPlayerId = this.state.round.currentPlayerId;
    const timer = setTimeout(() => {
      // Verify it's still this player's turn
      if (this.state.phase === 'playing' && this.state.round?.currentPlayerId === currentPlayerId) {
        const result = this.pass(currentPlayerId);
        if (result.success) {
          onAutoPass(currentPlayerId);
        }
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }
}
