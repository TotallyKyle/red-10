import type { GameState, PlayerState, ClientGameView, ClientPlayerView, Team } from '@red10/shared';
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

    return {
      gameId: this.state.id,
      phase: this.state.phase,
      myHand: me.hand,
      players: playerViews,
      round: this.state.round,
      doubling: this.state.doubling,
      stakeMultiplier: this.state.stakeMultiplier,
      isMyTurn: false, // placeholder for now
      validActions: [], // placeholder for now
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
