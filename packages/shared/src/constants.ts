// ---- Suits ----
// 1.5 standard deck = 3 red suits + 3 black suits
// hearts2 and clubs2 represent the extra half-deck's red and black suits

export const RED_SUITS = ['hearts', 'diamonds', 'hearts2'] as const;
export const BLACK_SUITS = ['clubs', 'spades', 'clubs2'] as const;
export const ALL_SUITS = [...RED_SUITS, ...BLACK_SUITS] as const;

// ---- Ranks ----
// Ordered from lowest (3) to highest (2)
export const ALL_RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;

// Numeric value for rank comparison. Higher = stronger.
export const RANK_ORDER: Record<string, number> = {
  '3': 0,
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  '8': 5,
  '9': 6,
  '10': 7,
  'J': 8,
  'Q': 9,
  'K': 10,
  'A': 11,
  '2': 12,
};

// ---- Game constants ----
export const TOTAL_CARDS = 78; // 6 suits × 13 ranks
export const PLAYER_COUNT = 6;
export const CARDS_PER_PLAYER = 13;
export const MIN_STRAIGHT_LENGTH = 3;
export const COPIES_PER_RANK = 6; // Each rank has 6 copies across all suits

// Cha-go opportunity timeout in milliseconds
export const CHA_GO_TIMEOUT_MS = 10_000;

// Rank display names (for UI)
export const RANK_DISPLAY: Record<string, string> = {
  '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
  '8': '8', '9': '9', '10': '10', 'J': 'J', 'Q': 'Q',
  'K': 'K', 'A': 'A', '2': '2',
};

export const SUIT_DISPLAY: Record<string, string> = {
  hearts: '♥', diamonds: '♦', hearts2: '♥',
  clubs: '♣', spades: '♠', clubs2: '♣',
};
