import type { Card, Suit, Rank, Play, PlayFormat } from '../src/types.js';
import { RED_SUITS } from '../src/constants.js';

/**
 * Create a card with minimal boilerplate.
 * Suit defaults to a red or black suit based on index to ensure variety.
 */
export function card(rank: Rank, suit: Suit = 'hearts'): Card {
  return {
    id: `${suit}-${rank}`,
    suit,
    rank,
    isRed: (RED_SUITS as readonly string[]).includes(suit),
  };
}

/** Shorthand: create a red 10 */
export function redTen(suit: Suit = 'hearts'): Card {
  return card('10', suit);
}

/** Shorthand: create a black 10 */
export function blackTen(suit: Suit = 'clubs'): Card {
  return card('10', suit);
}

/** Create multiple cards of the same rank with different suits */
export function cardsOfRank(rank: Rank, count: number): Card[] {
  const suits: Suit[] = ['hearts', 'diamonds', 'hearts2', 'clubs', 'spades', 'clubs2'];
  return suits.slice(0, count).map(suit => card(rank, suit));
}

/** Create a Play object from cards */
export function makePlay(
  cards: Card[],
  format: PlayFormat,
  playerId: string = 'player1',
): Play {
  return {
    playerId,
    cards,
    format,
    rankValue: Math.max(...cards.map(c => c.rank === '2' ? 12 : c.rank === 'A' ? 11 : parseInt(c.rank) || 0)),
    length: cards.length,
    timestamp: Date.now(),
  };
}
