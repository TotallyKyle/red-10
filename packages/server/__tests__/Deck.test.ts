import { describe, it, expect } from 'vitest';
import { createDeck, shuffle, deal } from '../src/game/Deck.js';
import { ALL_RANKS, ALL_SUITS, TOTAL_CARDS, PLAYER_COUNT, CARDS_PER_PLAYER } from '@red10/shared';

describe('createDeck', () => {
  it('produces exactly 78 cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(TOTAL_CARDS);
  });

  it('has all unique card IDs', () => {
    const deck = createDeck();
    const ids = deck.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(TOTAL_CARDS);
  });

  it('has exactly 3 red 10s (rank "10", isRed true)', () => {
    const deck = createDeck();
    const red10s = deck.filter((c) => c.rank === '10' && c.isRed);
    expect(red10s).toHaveLength(3);
  });

  it('has exactly 3 black 10s (rank "10", isRed false)', () => {
    const deck = createDeck();
    const black10s = deck.filter((c) => c.rank === '10' && !c.isRed);
    expect(black10s).toHaveLength(3);
  });

  it('each rank appears exactly 6 times', () => {
    const deck = createDeck();
    for (const rank of ALL_RANKS) {
      const count = deck.filter((c) => c.rank === rank).length;
      expect(count).toBe(6);
    }
  });

  it('each suit appears exactly 13 times', () => {
    const deck = createDeck();
    for (const suit of ALL_SUITS) {
      const count = deck.filter((c) => c.suit === suit).length;
      expect(count).toBe(13);
    }
  });
});

describe('shuffle', () => {
  it('returns same number of cards', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(deck.length);
  });

  it('returns cards in different order (with high probability)', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    // It's theoretically possible for shuffle to return the same order,
    // but the probability is astronomically low with 78 cards.
    const sameOrder = deck.every((c, i) => c.id === shuffled[i].id);
    expect(sameOrder).toBe(false);
  });

  it('does not mutate the original deck', () => {
    const deck = createDeck();
    const originalIds = deck.map((c) => c.id);
    shuffle(deck);
    const afterIds = deck.map((c) => c.id);
    expect(afterIds).toEqual(originalIds);
  });

  it('contains the same cards as the original', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    const originalIds = new Set(deck.map((c) => c.id));
    const shuffledIds = new Set(shuffled.map((c) => c.id));
    expect(shuffledIds).toEqual(originalIds);
  });
});

describe('deal', () => {
  it('returns 6 hands of 13 cards each', () => {
    const deck = shuffle(createDeck());
    const hands = deal(deck);
    expect(hands).toHaveLength(PLAYER_COUNT);
    for (const hand of hands) {
      expect(hand).toHaveLength(CARDS_PER_PLAYER);
    }
  });

  it('hands are disjoint (no shared cards)', () => {
    const deck = shuffle(createDeck());
    const hands = deal(deck);
    const allIds = hands.flat().map((c) => c.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(TOTAL_CARDS);
  });

  it('all 78 cards are distributed (no cards lost)', () => {
    const deck = shuffle(createDeck());
    const hands = deal(deck);
    const dealtIds = new Set(hands.flat().map((c) => c.id));
    const deckIds = new Set(deck.map((c) => c.id));
    expect(dealtIds).toEqual(deckIds);
  });
});
