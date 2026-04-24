import type { RED_SUITS, BLACK_SUITS, ALL_SUITS, ALL_RANKS } from './constants.js';

// ---- Card types ----

export type RedSuit = (typeof RED_SUITS)[number];
export type BlackSuit = (typeof BLACK_SUITS)[number];
export type Suit = (typeof ALL_SUITS)[number];
export type Rank = (typeof ALL_RANKS)[number];

export interface Card {
  /** Unique identifier, e.g. "hearts-10" or "clubs2-A" */
  id: string;
  suit: Suit;
  rank: Rank;
  /** true for hearts, diamonds, hearts2 */
  isRed: boolean;
}

// ---- Play types ----

export type PlayFormat = 'single' | 'pair' | 'straight' | 'paired_straight' | 'bomb';

export type SpecialBombType = 'red10_2' | 'red10_3' | 'fours_aces';

export interface Play {
  playerId: string;
  cards: Card[];
  format: PlayFormat;
  /** Highest rank value in the play, used for comparison */
  rankValue: number;
  /** Number of cards in the play */
  length: number;
  /** If this is a special bomb, which type */
  specialBomb?: SpecialBombType;
  timestamp: number;
}

export interface BombInfo {
  type: 'normal' | SpecialBombType;
  /** Total number of cards in the bomb */
  length: number;
  /**
   * For normal bombs: RANK_ORDER value of the repeated rank.
   * For special bombs (fours_aces, red10_2, red10_3): Infinity.
   */
  rankValue: number;
}

// ---- Cha-Go ----

export type ChaGoPhase = 'waiting_cha' | 'waiting_go' | 'waiting_final_cha';

export interface ChaGoState {
  /** The rank being cha-go'd */
  triggerRank: Rank;
  /** Current phase of the cha-go sequence */
  phase: ChaGoPhase;
  /** Player who played the cha (pair) */
  chaPlayerId: string | null;
  /** Player who played the go (single after cha) */
  goPlayerId: string | null;
  /** Player IDs eligible to cha/go in the current phase */
  eligiblePlayerIds: string[];
  /** Player IDs who have declined in the current phase */
  declinedPlayerIds: string[];
  /** How many copies of this rank remain unplayed across all hands */
  remainingCopies: number;
}

// ---- Doubling ----

export interface RevealedBomb {
  playerId: string;
  cards: Card[];
}

export interface DoublingState {
  /** Whose turn it is to declare */
  currentBidderId: string;
  isDoubled: boolean;
  isQuadrupled: boolean;
  /** Which team the doubler belongs to (null if no double yet) */
  doublerTeam: 'red10' | 'black10' | null;
  /** Bombs revealed by black 10 team during doubling */
  revealedBombs: RevealedBomb[];
  /** Whether teams are now public knowledge */
  teamsRevealed: boolean;
}

// ---- Player ----

export interface PlayerState {
  id: string;
  name: string;
  /** Seat position 0-5, clockwise */
  seatIndex: number;
  /** The player's current hand. Only sent to the owning player. */
  hand: Card[];
  /** Number of cards remaining (sent to all players) */
  handSize: number;
  /** Whether this player has played all their cards */
  isOut: boolean;
  /** Finishing position (1-based), null if still playing */
  finishOrder: number | null;
  /** Known team affiliation, null if not yet revealed */
  team: 'red10' | 'black10' | null;
  /** How many red 10s this player has revealed (0-3) */
  revealedRed10Count: number;
  /** Whether the player is currently connected */
  isConnected: boolean;
}

// ---- Round ----

export interface RoundInfo {
  /** Who started this round */
  leaderId: string;
  /** Whose turn it is */
  currentPlayerId: string;
  /** Format set by the opening play, null until leader plays */
  currentFormat: PlayFormat | null;
  /** The most recent play that must be beaten, null at round start */
  lastPlay: Play | null;
  /** Number of consecutive passes since the last play */
  passCount: number;
  /** Full history of plays in this round */
  plays: Play[];
  /** Cha-go state, null if not in cha-go */
  chaGoState: ChaGoState | null;
}

// ---- Game state ----

export type GamePhase = 'lobby' | 'dealing' | 'doubling' | 'playing' | 'scoring' | 'game_over';

export type Team = 'red10' | 'black10';

export interface GameState {
  /** Unique game/room ID */
  id: string;
  phase: GamePhase;
  players: PlayerState[];
  round: RoundInfo | null;
  doubling: DoublingState | null;
  /** 1 = normal, 2 = doubled, 4 = quadrupled */
  stakeMultiplier: number;
  /** Player IDs in clockwise turn order */
  turnOrder: string[];
  /** Player IDs in the order they went out */
  finishOrder: string[];
  /** Set when the first player goes out */
  scoringTeam: Team | null;
  /** Winner of the previous game, determines who goes first */
  previousGameWinner: string | null;
}

// ---- Client view (what each player sees) ----

export type ActionType =
  | 'play'
  | 'pass'
  | 'cha'
  | 'go_cha'
  | 'decline_cha'
  | 'double'
  | 'quadruple'
  | 'skip_double'
  | 'defuse';

export interface ClientPlayerView {
  id: string;
  name: string;
  seatIndex: number;
  handSize: number;
  isOut: boolean;
  finishOrder: number | null;
  /** null if this player's team is not yet revealed */
  team: Team | null;
  revealedRed10Count: number;
  isConnected: boolean;
}

export interface ClientGameView {
  gameId: string;
  phase: GamePhase;
  /** Only YOUR cards */
  myHand: Card[];
  /** All 6 players with limited info */
  players: ClientPlayerView[];
  round: RoundInfo | null;
  doubling: DoublingState | null;
  stakeMultiplier: number;
  isMyTurn: boolean;
  /** Actions available to you right now */
  validActions: ActionType[];
  /** You always know your own team */
  myTeam: Team;
  finishOrder: string[];
  scoringTeam: Team | null;
  gameResult?: GameResult;
  /** How many players are ready to play again */
  playAgainCount?: number;
}

// ---- Scoring ----

export interface GameResult {
  scoringTeam: Team;
  scoringTeamWon: boolean;
  /** Opposing team members who still have cards */
  trapped: string[];
  /** Dollar amount per trapped player per winning team member */
  payoutPerTrapped: number;
  /** Net dollar change for each player: playerId → amount (positive = earned, negative = paid) */
  payouts: Record<string, number>;
}

// ---- Socket events ----

export interface ServerToClientEvents {
  'game:state': (view: ClientGameView) => void;
  'game:update': (view: Partial<ClientGameView>) => void;
  'round:new': (data: { leaderId: string }) => void;
  'play:made': (data: { playerId: string; cards: Card[]; format: PlayFormat }) => void;
  'player:passed': (data: { playerId: string }) => void;
  'round:won': (data: { winnerId: string }) => void;
  'player:out': (data: { playerId: string; finishOrder: number }) => void;
  'cha_go:started': (data: { rank: Rank; chaPlayerId: string }) => void;
  'cha_go:opportunity': (data: { rank: Rank; timeoutMs: number }) => void;
  'cha_go:go_cha': (data: { playerId: string; cards: Card[] }) => void;
  'bomb:defused': (data: { defuserId: string; cards: Card[] }) => void;
  'team:revealed': (data: { playerId: string; team: Team; red10Count?: number }) => void;
  'double:declared': (data: { playerId: string; revealedCards?: Card[] }) => void;
  'game:scored': (result: GameResult) => void;
  'room:player_joined': (data: { player: { id: string; name: string }; hostId: string }) => void;
  'room:player_left': (data: { playerId: string }) => void;
  'room:player_removed': (data: { playerId: string }) => void;
  'room:player_ready': (data: { playerId: string }) => void;
  'room:host_changed': (data: { hostId: string }) => void;
  'error': (data: { message: string; code: string }) => void;
  'game:log_entry': (entry: GameLogEntryData) => void;
}

export interface GameLogEntryData {
  actor: string;
  detail: string;
  handSizes: Record<string, number>;
}

export interface ClientToServerEvents {
  'room:create': (
    data: { playerName: string },
    cb: (res: { success: boolean; error?: string; roomId?: string; reconnectToken?: string }) => void,
  ) => void;
  'room:join': (
    data: { roomId: string; playerName: string },
    cb: (res: { success: boolean; error?: string; reconnectToken?: string }) => void,
  ) => void;
  'room:ready': () => void;
  'room:start': () => void;
  'room:fill_bots': (cb: (res: { success: boolean; error?: string }) => void) => void;
  'double:declare': (data: { bombCards?: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'double:skip': () => void;
  'quadruple:declare': (data: { bombCards?: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'quadruple:skip': () => void;
  'play:cards': (data: { cards: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'play:pass': () => void;
  'play:cha': (data: { cards: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'play:go_cha': (data: { cards: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'play:defuse': (data: { cards: Card[] }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'cha:decline': () => void;
  'game:play_again': () => void;
  'room:rejoin': (
    data: { roomId: string; playerName: string; reconnectToken: string },
    cb: (res: { success: boolean; error?: string; reconnectToken?: string }) => void,
  ) => void;
  'game:get_log': (cb: (res: { log: string }) => void) => void;
}
