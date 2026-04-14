# Red 10 — Execution Plan

**Created**: 2026-04-14
**Status**: Planning

---

## Purpose / Big Picture

Build a browser-based multiplayer card game called "Red 10" where 6 players form hidden teams based on who holds red 10 cards, then race to empty their hands before the opposing team. After this is built, 6 people can open a browser, join a room, and play a full game of Red 10 with real-time updates — including hidden teams, doubling stakes, bombs, and the cha-go mechanic.

---

## Context and Orientation

This is a greenfield project. The repo at `/Users/kyle.zhang/Documents/Git/red-10/` is empty.

### Key Game Terminology

| Term | Definition |
|------|-----------|
| **Red 10 team** | Players holding one or more red 10s in their dealt hand |
| **Black 10 team** | Players NOT holding any red 10s |
| **Round** | A sequence of plays starting from a leader until everyone passes |
| **Bomb** | 3-of-a-kind or larger; can be played on any format |
| **Cha-go** | Interrupt mechanic where pairs/singles of the same rank are played in sequence |
| **Go-cha** | Playing 3-of-a-kind during cha-go to auto-win the round |
| **Trapped** | Opposing team members who haven't finished when the scoring team completes |
| **Double/Quadruple** | Pre-game stake multiplier declarations |
| **Defuse** | Black 10s cancelling a red 10 special bomb |

### Rank Order (low → high)
`3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2`

Rank index mapping: `{ 3:0, 4:1, 5:2, 6:3, 7:4, 8:5, 9:6, 10:7, J:8, Q:9, K:10, A:11, 2:12 }`

---

## Architecture Overview

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | React 18 + TypeScript + Vite | Fast dev iteration, strong typing for complex game state, Vite for instant HMR |
| **Backend** | Node.js + Express + TypeScript | Shared types with frontend, single language across stack |
| **Real-time** | Socket.IO | Reliable WebSocket abstraction with auto-reconnect, rooms, and namespaces built-in |
| **State** | In-memory on server | No persistence needed for MVP; game state lives only during active games |
| **Styling** | Tailwind CSS | Rapid UI development without writing custom CSS |
| **Monorepo** | npm workspaces | Share types/validation between client and server without publishing packages |

### Why NOT a database?
Games are ephemeral — a game starts, plays out over 15-60 minutes, and ends. There's no need to persist game state across server restarts for MVP. If we later want game history, leaderboards, or accounts, we can add SQLite or PostgreSQL. For now, in-memory maps give us zero latency and zero setup.

### Project Structure

```
red-10/
├── .plans/
│   └── PLAN-red10.md          # This file
├── package.json               # Workspace root
├── packages/
│   ├── shared/                # Shared types, constants, validation
│   │   ├── src/
│   │   │   ├── types.ts       # All game types/interfaces
│   │   │   ├── constants.ts   # Rank order, deck composition
│   │   │   ├── validation.ts  # Play validation logic (used by both client & server)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/                # Game server
│   │   ├── src/
│   │   │   ├── index.ts       # Express + Socket.IO setup
│   │   │   ├── lobby.ts       # Room management
│   │   │   ├── game/
│   │   │   │   ├── GameEngine.ts    # Core state machine
│   │   │   │   ├── Deck.ts          # Deck creation & shuffling
│   │   │   │   ├── Round.ts         # Round logic (normal + cha-go)
│   │   │   │   ├── Scoring.ts       # End-game scoring
│   │   │   │   ├── BombLogic.ts     # Bomb comparison & special bombs
│   │   │   │   └── Validation.ts    # Server-side move validation
│   │   │   └── socket/
│   │   │       └── handlers.ts      # Socket event handlers
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── client/                # React frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── hooks/
│       │   │   ├── useSocket.ts     # Socket.IO connection management
│       │   │   └── useGame.ts       # Game state subscription
│       │   ├── components/
│       │   │   ├── Lobby.tsx        # Room creation/joining
│       │   │   ├── GameTable.tsx     # Main game view
│       │   │   ├── PlayerHand.tsx    # Your cards (interactive)
│       │   │   ├── OtherPlayer.tsx   # Other player's card backs + status
│       │   │   ├── PlayArea.tsx      # Center area showing current plays
│       │   │   ├── ActionBar.tsx     # Play/Pass/Cha/Double buttons
│       │   │   ├── DoublingPhase.tsx # Pre-game doubling UI
│       │   │   ├── ScoreBoard.tsx    # End-game results
│       │   │   └── Card.tsx         # Single card component
│       │   ├── state/
│       │   │   └── gameStore.ts     # Zustand store for client game state
│       │   └── utils/
│       │       └── cardHelpers.ts   # Sorting, grouping, display helpers
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       └── tsconfig.json
└── tsconfig.base.json         # Shared TS config
```

---

## Data Model (packages/shared/src/types.ts)

### Card

```typescript
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'hearts2' | 'clubs2';
// hearts2/clubs2 represent the duplicate red/black suits in the 1.5 deck
// We use 3 red suits (hearts, diamonds, hearts2) and 3 black suits (clubs, spades, clubs2)

type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';

interface Card {
  id: string;          // Unique ID like "hearts-10-0" for deduplication
  suit: Suit;
  rank: Rank;
  isRed: boolean;      // Derived: hearts, diamonds, hearts2 are red
}

// Rank comparison value (used everywhere)
const RANK_ORDER: Record<Rank, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6,
  '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11, '2': 12
};
```

### Play Types

```typescript
type PlayFormat = 'single' | 'pair' | 'straight' | 'paired_straight' | 'bomb';

interface Play {
  playerId: string;
  cards: Card[];
  format: PlayFormat;
  // For comparison:
  rankValue: number;      // Highest rank value in the play
  length: number;         // Number of cards (matters for straights/bombs)
  isSpecialBomb?: 'red10_2' | 'red10_3' | 'fours_aces';  // Special bomb type
  timestamp: number;
}
```

### Game State

```typescript
type GamePhase = 'lobby' | 'dealing' | 'doubling' | 'playing' | 'scoring' | 'game_over';

type RoundState = 'normal' | 'cha_go';

interface PlayerState {
  id: string;
  name: string;
  seatIndex: number;       // 0-5, clockwise
  hand: Card[];            // Only sent to the owning player
  handSize: number;        // Sent to everyone
  isOut: boolean;          // Has played all cards
  finishOrder: number | null;  // 1st, 2nd, etc. (null if still playing)
  team: 'red10' | 'black10' | null;  // null = unknown to this viewer
  revealedRed10Count: number;  // How many red 10s this player has revealed (0-3)
  isConnected: boolean;
}

interface RoundInfo {
  leaderId: string;         // Who started this round
  currentPlayerId: string;  // Whose turn it is
  currentFormat: PlayFormat | null;  // null = leader hasn't played yet
  lastPlay: Play | null;    // The play that must be beaten
  passCount: number;        // Consecutive passes (round ends when all active pass)
  plays: Play[];            // History of plays in this round
  // Cha-go state
  chaGoState: ChaGoState | null;
}

interface ChaGoState {
  triggerRank: Rank;        // The rank being cha-go'd
  phase: 'waiting_cha' | 'waiting_go' | 'waiting_final_cha';
  // 'waiting_cha' = a single was played, waiting for someone to cha with a pair
  // 'waiting_go' = a pair was cha'd, waiting for a single (go)
  // 'waiting_final_cha' = a single was go'd, waiting for final pair (cha)
  chaPlayerId: string | null;   // Who played the cha
  remainingCopies: number;      // How many of this rank are still unplayed in hands
}

interface DoublingState {
  currentBidderId: string;   // Whose turn to declare
  isDoubled: boolean;
  isQuadrupled: boolean;
  doublerTeam: 'red10' | 'black10' | null;
  revealedBombs: { playerId: string; cards: Card[] }[];  // Bombs shown during doubling
  teamsRevealed: boolean;    // Whether red 10s have been forced revealed
}

interface GameState {
  id: string;               // Game/room ID
  phase: GamePhase;
  players: PlayerState[];   // Always 6 in a game
  round: RoundInfo | null;
  doubling: DoublingState | null;
  stakeMultiplier: number;  // 1, 2, or 4
  turnOrder: string[];      // Player IDs in clockwise order
  finishOrder: string[];    // Player IDs in order they went out
  scoringTeam: 'red10' | 'black10' | null;  // Set when first player goes out
  previousGameWinner: string | null;  // For determining who goes first
}
```

### Client View (what the server sends to each player)

```typescript
// The server NEVER sends other players' hands.
// Each client gets a personalized view:
interface ClientGameView {
  gameId: string;
  phase: GamePhase;
  myHand: Card[];                    // Only YOUR cards
  players: ClientPlayerView[];       // All 6 players with limited info
  round: RoundInfo | null;           // Current round (plays are public)
  doubling: DoublingState | null;
  stakeMultiplier: number;
  isMyTurn: boolean;
  validActions: ActionType[];        // What you can do right now
  myTeam: 'red10' | 'black10';      // You always know your own team
  finishOrder: string[];
  scoringTeam: 'red10' | 'black10' | null;
}

interface ClientPlayerView {
  id: string;
  name: string;
  seatIndex: number;
  handSize: number;          // Can see how many cards others have
  isOut: boolean;
  finishOrder: number | null;
  team: 'red10' | 'black10' | null;  // null if not yet revealed TO YOU
  revealedRed10Count: number;
  isConnected: boolean;
}

type ActionType =
  | 'play'          // Play cards
  | 'pass'          // Pass turn
  | 'cha'           // Cha with a pair (cha-go)
  | 'go_cha'        // Go-cha with 3-of-a-kind
  | 'double'        // Declare double
  | 'quadruple'     // Counter-double
  | 'skip_double'   // Pass on doubling
  | 'defuse';       // Play black 10s to defuse red 10 bomb
```

---

## Game State Machine

```
                    ┌─────────┐
                    │  LOBBY  │
                    └────┬────┘
                         │ 6 players ready
                         ▼
                    ┌─────────┐
                    │ DEALING │  (shuffle, deal 13 each, determine hidden teams)
                    └────┬────┘
                         │
                         ▼
                   ┌───────────┐
                   │ DOUBLING  │◄──── each player in turn: double / skip
                   └─────┬─────┘
                         │ all players done (or double declared + quadruple response)
                         ▼
                   ┌───────────┐
              ┌───►│  PLAYING  │◄─────────────────────┐
              │    └─────┬─────┘                       │
              │          │                             │
              │          ▼                             │
              │    ┌───────────┐    round won     ┌────┴──────┐
              │    │   ROUND   │─────────────────►│ NEW ROUND │
              │    └─────┬─────┘                  └───────────┘
              │          │
              │          │ player finishes hand
              │          ▼
              │    ┌──────────────┐
              │    │ CHECK_SCORE  │──── game not over ──►┐
              │    └──────┬───────┘                      │
              │           │                              │
              │           │ game over                    │
              │           ▼                              │
              │    ┌───────────┐                         │
              │    │  SCORING  │                         │
              │    └─────┬─────┘                         │
              │          │                               │
              │          ▼                               │
              │    ┌───────────┐                         │
              └────┤ GAME_OVER │  (play again?)          │
                   └───────────┘                         │
                                                         │
              ◄──────────────────────────────────────────┘
```

### Round Sub-State Machine

```
  ┌──────────────┐
  │ ROUND_START  │  (leader plays opening cards)
  └──────┬───────┘
         │ leader plays
         ▼
  ┌──────────────┐     single played     ┌─────────────────────┐
  │ NORMAL_PLAY  │◄────────────────────── │ CHA_GO_OPPORTUNITY  │
  │              │─────────────────────►  │ (2s timeout/all     │
  │              │  if single & format    │  respond)            │
  │              │  is singles            └──────────┬──────────┘
  └──────┬───────┘                                   │ someone chas
         │                                           ▼
         │ all pass              ┌─────────────────────────────┐
         ▼                       │       CHA_GO_ACTIVE         │
  ┌──────────────┐               │  waiting_go → waiting_cha   │
  │  ROUND_END   │               │  → waiting_go → ...         │
  │ (winner set) │               │  OR go-cha (auto-win)       │
  └──────────────┘               └──────────┬──────────────────┘
         ▲                                  │ all pass or
         │                                  │ final cha or go-cha
         └──────────────────────────────────┘
```

### Score Check Logic

```
When a player finishes their hand:
  1. Add them to finishOrder
  2. If they are the FIRST player out:
     → Set scoringTeam = their team
  3. Check: has the entire scoring team finished?
     → YES: game over, scoring team wins. Trapped = opposing members still with cards.
  4. Check: has the entire opposing team finished?
     → YES: game over, scoring team gets NOTHING (they failed).
  5. Otherwise: continue playing, skip this player in turn order.
```

---

## Socket.IO Event Protocol

### Client → Server Events

```typescript
// Lobby
'room:create'       → { playerName: string }                    → { roomId: string }
'room:join'         → { roomId: string, playerName: string }    → { success: boolean }
'room:ready'        → { }                                       → void
'room:start'        → { }                                       → void  // host only

// Doubling Phase
'double:declare'    → { bombCards?: Card[] }                     → { success: boolean }
'double:skip'       → { }                                       → void
'quadruple:declare' → { }                                       → { success: boolean }
'quadruple:skip'    → { }                                       → void

// Playing
'play:cards'        → { cards: Card[] }                          → { success: boolean, error?: string }
'play:pass'         → { }                                        → void
'play:cha'          → { cards: Card[] }                          → { success: boolean }
'play:go_cha'       → { cards: Card[] }                          → { success: boolean }
'play:defuse'       → { cards: Card[] }                          → { success: boolean }
'cha:decline'       → { }                                        → void  // Explicitly decline cha opportunity

// Meta
'game:play_again'   → { }                                        → void
```

### Server → Client Events

```typescript
// State updates (sent as personalized ClientGameView)
'game:state'        → ClientGameView        // Full state sync (on join, game start)
'game:update'       → Partial<ClientGameView> // Delta updates during play

// Specific events (for animations/sounds)
'round:new'         → { leaderId: string }
'play:made'         → { playerId: string, cards: Card[], format: PlayFormat }
'player:passed'     → { playerId: string }
'round:won'         → { winnerId: string }
'player:out'        → { playerId: string, finishOrder: number }
'cha_go:started'    → { rank: Rank, chaPlayerId: string }
'cha_go:go_cha'     → { playerId: string, cards: Card[] }
'bomb:defused'      → { defuserId: string, cards: Card[] }
'team:revealed'     → { playerId: string, team: 'red10' | 'black10', red10Count?: number }
'double:declared'   → { playerId: string, revealedCards?: Card[] }
'game:scored'       → { scoringTeam: string, trapped: string[], payout: number }

// Cha-go opportunity (sent to players who CAN cha)
'cha_go:opportunity' → { rank: Rank, timeoutMs: number }

// Lobby
'room:player_joined'  → { player: { id, name } }
'room:player_left'    → { playerId: string }
'room:player_ready'   → { playerId: string }

// Errors
'error'              → { message: string, code: string }
```

---

## Core Logic Specifications

### Deck Creation (`packages/server/src/game/Deck.ts`)

Creates 78 cards: 6 suits × 13 ranks.

```typescript
const RED_SUITS: Suit[] = ['hearts', 'diamonds', 'hearts2'];
const BLACK_SUITS: Suit[] = ['clubs', 'spades', 'clubs2'];
const ALL_SUITS: Suit[] = [...RED_SUITS, ...BLACK_SUITS];
const ALL_RANKS: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      cards.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        isRed: RED_SUITS.includes(suit),
      });
    }
  }
  return cards; // 78 cards
}

function shuffle(cards: Card[]): Card[] {
  // Fisher-Yates shuffle
}

function deal(deck: Card[]): Card[][] {
  // Returns 6 hands of 13 cards each
}
```

A card is a **red 10** if `card.rank === '10' && card.isRed === true`. There are exactly 3 red 10s and 3 black 10s.

### Play Validation (`packages/shared/src/validation.ts`)

This is the most complex module. It must validate:

**1. Format detection** — Given a set of cards, determine what format they are:

```typescript
function detectFormat(cards: Card[]): PlayFormat | null {
  if (cards.length === 1) return 'single';
  if (cards.length === 2 && sameRank(cards)) return 'pair';
  if (cards.length >= 3 && allSameRank(cards)) return 'bomb';
  if (cards.length >= 3 && isConsecutive(cards)) return 'straight';
  if (cards.length >= 6 && isPairedStraight(cards)) return 'paired_straight';
  if (isSpecialBomb(cards)) return 'bomb';
  return null; // Invalid
}
```

**2. Straight validation**:
- Minimum 3 cards
- All different ranks
- Consecutive in rank order
- Special: A(11)-2(12)-3(0) is valid → treated as low straight starting at A with value = rank of 3 (the lowest)
  - Actually, A-2-3 means A and 2 are low. So the straight rank order for this case: A=low, 2=next, 3=next.
  - For straights specifically: A can be low (A-2-3) where A has value -1, 2 has value 0, 3 has value 1...
  - Simpler approach: define two possible rank sequences for A:
    - Normal: A has rank value 11 (high, used in Q-K-A)
    - Low: A has rank value -2, 2 has rank value -1, 3 has rank value 0 (used in A-2-3, A-2-3-4, etc.)
  - 2 CANNOT be the high end of a straight (e.g., Q-K-A-2 is INVALID)
  - K-A-2 wrapping is INVALID

```typescript
function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  if (!allDifferentRanks(cards)) return false;

  const ranks = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);

  // Check normal consecutive
  if (isConsecutiveArray(ranks)) {
    // Make sure 2 (value 12) is not present unless it's part of A-2-3 low straight
    // Actually 2 CAN be in a straight, just not as the high end of a big straight.
    // So 10-J-Q-K-A is valid. Q-K-A is valid. A-2-3 is valid.
    // K-A-2 is INVALID (wrapping).
    // But 3-4-5...K-A is valid. What about ...K-A-2? No, that wraps.
    // The key rule: 2 cannot be at the high end of a normal straight.
    // Since 2 has rank_value=12 and A has rank_value=11:
    //   - If the straight contains 2 (12) and A (11), check if it also contains 3 (0).
    //     If yes → it's trying to wrap (K-A-2-3?) → INVALID
    //     If no → it's ...K-A-2 → INVALID (2 at top of big straight)
    //   - If the straight contains 2 (12) but not A (11) → INVALID (can't have 2 without A
    //     in a non-wrapping straight since 2 is rank 12 and nothing is rank 13)
    //     Actually wait, if sorted ranks are [10,11,12] that's Q-K-A... no, Q=9, K=10, A=11, 2=12
    //     So [10,11,12] = K-A-2. That's invalid.
    // Simpler rule: a normal consecutive straight that includes 2 (value 12) is INVALID.
    if (ranks.includes(12)) return false;  // 2 at top = invalid
    return true;
  }

  // Check low-ace straight: A-2-3...
  // Remap: A(11)→-2, 2(12)→-1, keep others as-is
  if (ranks.includes(11) && ranks.includes(12) && ranks.includes(0)) {
    const remapped = ranks.map(r => {
      if (r === 11) return -2;  // A goes low
      if (r === 12) return -1;  // 2 goes low
      return r;
    }).sort((a, b) => a - b);
    return isConsecutiveArray(remapped);
  }

  return false;
}
```

**Straight comparison**: compare by the HIGHEST rank value in the straight. Same-length straights only; you cannot beat a 5-card straight with a 3-card straight. (Bombs can beat any format though.)

**3. Bomb validation and comparison**:

```typescript
interface BombInfo {
  type: 'normal' | 'fours_aces' | 'red10_2' | 'red10_3';
  length: number;       // Total cards
  rankValue: number;    // For normal: rank of the repeated card. For fours_aces: special high value.
}

function classifyBomb(cards: Card[]): BombInfo | null {
  // Check special bombs first:

  // 3 red 10s: the ultimate bomb
  if (cards.length === 3 && cards.every(c => c.rank === '10' && c.isRed)) {
    return { type: 'red10_3', length: 3, rankValue: Infinity };
    // Beats everything. Only defused by 3 black 10s.
  }

  // 2 red 10s: tied for largest 5-card bomb
  if (cards.length === 2 && cards.every(c => c.rank === '10' && c.isRed)) {
    return { type: 'red10_2', length: 2, rankValue: Infinity };
    // Treated as equivalent to 5-card bomb tier. Defused by 2 black 10s.
  }

  // Pair of 4s + N aces (N >= 1): highest bomb at its length tier
  const fours = cards.filter(c => c.rank === '4');
  const aces = cards.filter(c => c.rank === 'A');
  if (fours.length === 2 && aces.length >= 1 && fours.length + aces.length === cards.length) {
    return { type: 'fours_aces', length: cards.length, rankValue: Infinity };
    // Highest bomb at (2 + N_aces) card length
  }

  // Normal bomb: 3+ of the same rank
  if (cards.length >= 3 && allSameRank(cards)) {
    return { type: 'normal', length: cards.length, rankValue: RANK_ORDER[cards[0].rank] };
  }

  return null;
}

function compareBombs(a: BombInfo, b: BombInfo): number {
  // 3 red 10s beats everything
  if (a.type === 'red10_3') return 1;
  if (b.type === 'red10_3') return -1;

  // 2 red 10s is treated as a 5-card bomb tier
  const aEffectiveLength = a.type === 'red10_2' ? 5 : a.length;
  const bEffectiveLength = b.type === 'red10_2' ? 5 : b.length;

  // Longer bombs beat shorter
  if (aEffectiveLength !== bEffectiveLength) return aEffectiveLength - bEffectiveLength;

  // Same length: fours_aces is highest at that tier
  // And 2 red 10s is tied with fours_aces at 5-card tier
  if (a.type === 'fours_aces' || a.type === 'red10_2') {
    if (b.type === 'fours_aces' || b.type === 'red10_2') return 0; // tied
    return 1;
  }
  if (b.type === 'fours_aces' || b.type === 'red10_2') return -1;

  // Same length normal bombs: compare rank
  return a.rankValue - b.rankValue;
}
```

**4. Defuse validation**:
```typescript
function isValidDefuse(defuseCards: Card[], bombCards: Card[]): boolean {
  const bombInfo = classifyBomb(bombCards);
  if (!bombInfo) return false;

  if (bombInfo.type === 'red10_2') {
    // Need exactly 2 black 10s
    return defuseCards.length === 2
      && defuseCards.every(c => c.rank === '10' && !c.isRed);
  }
  if (bombInfo.type === 'red10_3') {
    // Need exactly 3 black 10s
    return defuseCards.length === 3
      && defuseCards.every(c => c.rank === '10' && !c.isRed);
  }
  return false; // Only red 10 bombs can be defused
}
```

**5. Can-beat logic**:
```typescript
function canBeat(newPlay: Card[], currentPlay: Play, currentFormat: PlayFormat): boolean {
  const newFormat = detectFormat(newPlay);
  if (!newFormat) return false;

  // Bombs can beat anything
  if (newFormat === 'bomb') {
    if (currentPlay.format === 'bomb') {
      return compareBombs(classifyBomb(newPlay)!, classifyBomb(currentPlay.cards)!) > 0;
    }
    return true; // Bomb beats non-bomb
  }

  // Non-bomb must match format and length
  if (newFormat !== currentFormat) return false;
  if (newPlay.length !== currentPlay.cards.length) return false;

  // Compare by highest rank value
  const newRank = getHighestRank(newPlay);
  const currentRank = getHighestRank(currentPlay.cards);
  return newRank > currentRank;
}
```

### Cha-Go Logic (`packages/server/src/game/Round.ts`)

The cha-go mechanic is an interrupt system. When a single is played:

1. Server checks if any player holds a pair of that rank
2. If yes, server broadcasts `cha_go:opportunity` to those players with a timeout (e.g., 10 seconds)
3. Players can respond with `play:cha` or `cha:decline`
4. If multiple players can cha, first to respond wins (or follow clockwise priority from the single player)
5. Once cha'd, play continues clockwise from the cha player, looking for a single of that rank (the "go")
6. After a "go", look for final cha (last pair of that rank)
7. At any point, a player with 3 of that rank can "go-cha" to auto-win

**Tracking remaining copies**: The server knows all hands. For rank R, there are 6 total copies in the deck. The server tracks how many are in players' hands vs already played to know what cha-go steps are possible.

### Scoring (`packages/server/src/game/Scoring.ts`)

```typescript
interface GameResult {
  scoringTeam: 'red10' | 'black10';
  scoringTeamWon: boolean;
  trapped: PlayerState[];         // Opposing team members still with cards
  payout: number;                 // Per trapped player per winning team member
  totalPayouts: Map<string, number>;  // playerId → net $ change
}

function calculateScore(state: GameState): GameResult {
  const scoringTeam = state.scoringTeam!;
  const opposingTeam = scoringTeam === 'red10' ? 'black10' : 'red10';

  const scoringPlayers = state.players.filter(p => p.team === scoringTeam);
  const opposingPlayers = state.players.filter(p => p.team === opposingTeam);

  const allScoringOut = scoringPlayers.every(p => p.isOut);
  const allOpposingOut = opposingPlayers.every(p => p.isOut);

  if (allScoringOut) {
    // Scoring team wins!
    const trapped = opposingPlayers.filter(p => !p.isOut);
    const payoutPerTrapped = state.stakeMultiplier; // 1, 2, or 4
    // Each trapped player pays payoutPerTrapped to EACH scoring team member
    // Each scoring team member receives: trapped.length * payoutPerTrapped
    // Each trapped player pays: scoringPlayers.length * payoutPerTrapped
  }

  if (allOpposingOut) {
    // Opposing team all got out → scoring team gets nothing
    return { scoringTeam, scoringTeamWon: false, trapped: [], payout: 0, ... };
  }
}
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│                    Player 4 (top)                    │
│                  [███] 8 cards                       │
│         Player 3          Player 5                   │
│        [███] 10          [███] 5                     │
│                                                      │
│                 ┌──────────────────┐                 │
│                 │                  │                 │
│                 │    PLAY AREA     │                 │
│                 │  (current play)  │                 │
│                 │                  │                 │
│                 └──────────────────┘                 │
│         Player 2          Player 6                   │
│        [███] 13          [███] 11                    │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │  YOUR HAND (Player 1)                         │  │
│  │  [3♠][4♥][4♦][5♣][7♠][7♥][10♦][J♣][Q♠][K♥] │  │
│  │  [K♠][A♣][2♥]                                 │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  [ PLAY ]  [ PASS ]  [ CHA! ]        Stakes: $1    │
│                                        Round: 3     │
└─────────────────────────────────────────────────────┘
```

Players are arranged in a circle (hexagonal seating). You are always at the bottom. Cards fan out in your hand and are selectable by clicking. Other players show card backs + count.

---

## Implementation Milestones

### Milestone 1: Project Scaffold & Shared Types
**Goal**: Monorepo with build pipeline, all shared types compiling, dev servers running.

**Steps**:
1. Initialize npm workspace root with `packages/shared`, `packages/server`, `packages/client`
2. Set up TypeScript configs (base + per-package)
3. Write all types in `packages/shared/src/types.ts`
4. Write constants in `packages/shared/src/constants.ts`
5. Set up Vite for client, ts-node/nodemon for server
6. Verify: `npm run dev` starts both client and server, shared types are importable

**Validation**: Run `npm run build` — all packages compile. Run `npm run dev` — client on :5173, server on :3001.

---

### Milestone 2: Lobby & Room System
**Goal**: Players can create rooms, join with a name, see other players, and start a game when 6 are present.

**Steps**:
1. Implement Socket.IO server with room management in `lobby.ts`
2. Build `Lobby.tsx` — create room, join room (by code), player list, ready/start buttons
3. Wire up socket events for join/leave/ready
4. Room host can start game when 6 players are connected

**Validation**: Open 6 browser tabs, all join same room, host clicks start, all see "game starting".

---

### Milestone 3: Deck, Deal & Hand Display
**Goal**: Cards are dealt, each player sees their 13-card hand, teams are secretly assigned.

**Steps**:
1. Implement `Deck.ts` — create, shuffle, deal
2. On game start, server deals and stores hands
3. Server sends each player only their hand via `game:state`
4. Build `PlayerHand.tsx` — render cards, allow selection
5. Build `Card.tsx` — visual card component with suit/rank
6. Build `GameTable.tsx` — hexagonal layout showing all 6 players
7. Build `OtherPlayer.tsx` — card backs + count

**Validation**: Start a game, each tab sees 13 unique cards, total across all tabs = 78.

---

### Milestone 4: Basic Round Play (Singles & Pairs)
**Goal**: Players can take turns playing singles and pairs, pass, and win rounds.

**Steps**:
1. Implement `GameEngine.ts` state machine — round lifecycle
2. Implement basic validation (singles, pairs) in shared `validation.ts`
3. Server enforces turn order, validates plays, broadcasts updates
4. Build `PlayArea.tsx` — shows the current/last play
5. Build `ActionBar.tsx` — Play/Pass buttons, enabled based on `validActions`
6. Handle round end (all pass) → new round with winner as leader

**Validation**: Play a few rounds of singles and pairs across 6 tabs. Turn order correct, invalid plays rejected, rounds reset properly.

---

### Milestone 5: Straights & Paired Straights
**Goal**: Full straight and paired-straight validation and play.

**Steps**:
1. Implement straight validation including A-2-3 low and Q-K-A high
2. Implement paired straight validation
3. Add to canBeat logic — same format, same length, higher rank
4. Client-side hand grouping helpers (detect possible straights in your hand)

**Validation**: Play rounds starting with straights of various lengths. Verify A-2-3 works, K-A-2 rejected, Q-K-A works, 2 can't be at top of big straight.

---

### Milestone 6: Bombs
**Goal**: All bomb types work — normal, fours+aces, red 10 specials, defuse.

**Steps**:
1. Implement bomb classification and comparison
2. Bombs can be played on any format
3. Implement red 10 special bombs (2 red 10s, 3 red 10s)
4. Implement black 10 defuse mechanic
5. When red 10 is played → reveal that player's team
6. After defuse: round continues in appropriate format (pairs for 2 black 10s, bomb of 3 10s for 3 black 10s)

**Validation**: Play a bomb on top of singles. Play bigger bomb on smaller bomb. Play 2 red 10s, defuse with 2 black 10s, round continues as pairs. Play 3 red 10s, verify it beats 4,4,A,A,A,A.

---

### Milestone 7: Cha-Go
**Goal**: Full cha-go interrupt mechanic working.

**Steps**:
1. After any single is played, server checks if any player has a pair of that rank
2. Send `cha_go:opportunity` to eligible players with a countdown timer
3. Implement cha → go → final cha sequence with proper turn tracking
4. Implement go-cha (3-of-a-kind auto-win)
5. Handle passes at each cha-go step
6. UI: "CHA!" button appears with timer when you can cha

**Validation**: Play a single, see cha opportunity appear, cha with pair, continue go sequence, verify round winner. Test go-cha. Test declining cha.

---

### Milestone 8: Doubling Phase
**Goal**: Pre-game doubling with team reveals.

**Steps**:
1. After deal, enter doubling phase
2. Each player in turn can double or skip
3. Black 10 team doubling: UI to select & reveal bomb cards
4. Red 10 team doubling: auto-reveal all red 10s
5. After any double: all red 10s revealed, teams go public
6. Opposing team gets quadruple opportunity
7. Set stake multiplier accordingly

**Validation**: Start game, go through doubling phase. Verify red 10 reveal, bomb reveal, quadruple option, stake displays correctly.

---

### Milestone 9: Scoring & Going Out
**Goal**: Players can finish their hands, scoring logic works, game ends properly.

**Steps**:
1. When a player plays their last card(s), mark them as out
2. Skip out players in turn order
3. Track finish order
4. First player out sets scoring team
5. Implement score check after each player goes out
6. Display game results with payout calculation
7. "Play Again" button → new game with winner going first

**Validation**: Play a full game to completion. Verify trapped player count, payout math, correct winner determination. Test the edge case where opposing team all finishes before last scoring team member.

---

### Milestone 10: Polish & Edge Cases
**Goal**: Production-quality game experience.

**Steps**:
1. Reconnection handling (player disconnects and rejoins)
2. Card animations (playing, dealing, cha-go interrupts)
3. Sound effects for key actions
4. Team indicator UI (color coding after reveal)
5. Game history/log panel showing all plays
6. Timer for turns (optional, configurable)
7. Mobile-responsive layout
8. Handle edge cases: last player standing auto-wins all remaining rounds, player with no valid plays must pass, etc.

**Validation**: Full playtesting with 6 people. Disconnect/reconnect mid-game. Play on mobile.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-14 | In-memory state, no DB | Games are ephemeral; DB adds complexity with no benefit for MVP |
| 2026-04-14 | Socket.IO over raw WS | Built-in rooms, reconnect, fallback to polling — perfect for game lobbies |
| 2026-04-14 | Server-authoritative | Players only see their own cards; all validation on server prevents cheating |
| 2026-04-14 | Monorepo with shared package | Card validation logic needed on both client (for UI hints) and server (for enforcement) |
| 2026-04-14 | Cha-go as timed interrupt | Need a timeout so game doesn't stall if a player can cha but is AFK |

---

## Progress

- [ ] Milestone 1: Project Scaffold
- [ ] Milestone 2: Lobby & Rooms
- [ ] Milestone 3: Deck, Deal & Hands
- [ ] Milestone 4: Basic Round Play
- [ ] Milestone 5: Straights
- [ ] Milestone 6: Bombs
- [ ] Milestone 7: Cha-Go
- [ ] Milestone 8: Doubling
- [ ] Milestone 9: Scoring
- [ ] Milestone 10: Polish
