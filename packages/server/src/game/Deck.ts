import { ALL_SUITS, ALL_RANKS, RED_SUITS, TOTAL_CARDS, PLAYER_COUNT, CARDS_PER_PLAYER } from '@red10/shared';
import type { Card } from '@red10/shared';

const redSuitSet = new Set<string>(RED_SUITS);

/**
 * Creates the 78-card deck (6 suits x 13 ranks).
 * 3 red suits: hearts, diamonds, hearts2
 * 3 black suits: clubs, spades, clubs2
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        isRed: redSuitSet.has(suit),
      });
    }
  }

  if (deck.length !== TOTAL_CARDS) {
    throw new Error(`Deck should have ${TOTAL_CARDS} cards but has ${deck.length}`);
  }

  return deck;
}

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 */
export function shuffle(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deals cards evenly to 6 players (13 each).
 * Returns an array of 6 hands.
 */
export function deal(deck: Card[]): Card[][] {
  if (deck.length !== TOTAL_CARDS) {
    throw new Error(`Cannot deal: expected ${TOTAL_CARDS} cards, got ${deck.length}`);
  }

  const hands: Card[][] = Array.from({ length: PLAYER_COUNT }, () => []);

  for (let i = 0; i < deck.length; i++) {
    hands[i % PLAYER_COUNT].push(deck[i]);
  }

  // Validate each hand has the right count
  for (const hand of hands) {
    if (hand.length !== CARDS_PER_PLAYER) {
      throw new Error(`Hand should have ${CARDS_PER_PLAYER} cards but has ${hand.length}`);
    }
  }

  return hands;
}
