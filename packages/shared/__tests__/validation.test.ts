import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  isValidStraight,
  isValidPairedStraight,
  straightValue,
  classifyBomb,
  compareBombs,
  canBeat,
  isValidDefuse,
  defuseResultFormat,
  rankValue,
} from '../src/validation.js';
import { card, redTen, blackTen, cardsOfRank, makePlay } from './helpers.js';

// ============================================================
// Format Detection
// ============================================================

describe('detectFormat', () => {
  it('detects a single card', () => {
    expect(detectFormat([card('5')])).toBe('single');
  });

  it('detects a pair', () => {
    expect(detectFormat([card('7', 'hearts'), card('7', 'clubs')])).toBe('pair');
  });

  it('returns null for two different ranks', () => {
    expect(detectFormat([card('7'), card('8')])).toBeNull();
  });

  it('detects a 3-of-a-kind bomb', () => {
    expect(detectFormat(cardsOfRank('K', 3))).toBe('bomb');
  });

  it('detects a 4-of-a-kind bomb', () => {
    expect(detectFormat(cardsOfRank('9', 4))).toBe('bomb');
  });

  it('detects a 5-of-a-kind bomb', () => {
    expect(detectFormat(cardsOfRank('6', 5))).toBe('bomb');
  });

  it('detects a 6-of-a-kind bomb', () => {
    expect(detectFormat(cardsOfRank('J', 6))).toBe('bomb');
  });

  it('detects a straight (3-4-5)', () => {
    const cards = [card('3'), card('4', 'clubs'), card('5', 'diamonds')];
    expect(detectFormat(cards)).toBe('straight');
  });

  it('detects a paired straight (3-3-4-4-5-5)', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'),
      card('4', 'hearts'), card('4', 'clubs'),
      card('5', 'hearts'), card('5', 'clubs'),
    ];
    expect(detectFormat(cards)).toBe('paired_straight');
  });

  it('detects 2 red 10s as a bomb', () => {
    const cards = [redTen('hearts'), redTen('diamonds')];
    expect(detectFormat(cards)).toBe('bomb');
  });

  it('detects 3 red 10s as a bomb', () => {
    const cards = [redTen('hearts'), redTen('diamonds'), redTen('hearts2')];
    expect(detectFormat(cards)).toBe('bomb');
  });

  it('detects 4-4-A as a bomb', () => {
    const cards = [card('4', 'hearts'), card('4', 'clubs'), card('A', 'diamonds')];
    expect(detectFormat(cards)).toBe('bomb');
  });

  it('returns null for empty cards', () => {
    expect(detectFormat([])).toBeNull();
  });

  it('returns null for invalid combination (3-5-8)', () => {
    expect(detectFormat([card('3'), card('5'), card('8')])).toBeNull();
  });
});

// ============================================================
// Straight Validation
// ============================================================

describe('isValidStraight', () => {
  it('accepts 3-4-5', () => {
    expect(isValidStraight([card('3'), card('4', 'clubs'), card('5', 'diamonds')])).toBe(true);
  });

  it('accepts 3-4-5-6-7-8-9-10-J-Q-K-A (12-card straight)', () => {
    const cards = ['3','4','5','6','7','8','9','10','J','Q','K','A'].map(
      (r, i) => card(r as any, i % 2 === 0 ? 'hearts' : 'clubs')
    );
    expect(isValidStraight(cards)).toBe(true);
  });

  it('accepts Q-K-A (A at the top)', () => {
    expect(isValidStraight([card('Q'), card('K', 'clubs'), card('A', 'diamonds')])).toBe(true);
  });

  it('accepts A-2-3 (low ace straight)', () => {
    expect(isValidStraight([card('A'), card('2', 'clubs'), card('3', 'diamonds')])).toBe(true);
  });

  it('accepts A-2-3-4 (extended low ace straight)', () => {
    expect(isValidStraight([
      card('A'), card('2', 'clubs'), card('3', 'diamonds'), card('4', 'spades')
    ])).toBe(true);
  });

  it('accepts A-2-3-4-5 (5-card low ace straight)', () => {
    expect(isValidStraight([
      card('A'), card('2', 'clubs'), card('3', 'diamonds'), card('4', 'spades'), card('5', 'hearts2')
    ])).toBe(true);
  });

  it('rejects K-A-2 (no wrapping)', () => {
    expect(isValidStraight([card('K'), card('A', 'clubs'), card('2', 'diamonds')])).toBe(false);
  });

  it('rejects Q-K-A-2 (2 cannot be at top of big straight)', () => {
    expect(isValidStraight([
      card('Q'), card('K', 'clubs'), card('A', 'diamonds'), card('2', 'spades')
    ])).toBe(false);
  });

  it('rejects fewer than 3 cards', () => {
    expect(isValidStraight([card('3'), card('4')])).toBe(false);
  });

  it('rejects duplicate ranks', () => {
    expect(isValidStraight([card('3', 'hearts'), card('3', 'clubs'), card('4')])).toBe(false);
  });

  it('rejects non-consecutive ranks (3-5-7)', () => {
    expect(isValidStraight([card('3'), card('5'), card('7')])).toBe(false);
  });
});

describe('straightValue', () => {
  it('returns highest rank value for normal straight', () => {
    // 3-4-5: highest is 5 (value 2)
    const val = straightValue([card('3'), card('4', 'clubs'), card('5', 'diamonds')]);
    expect(val).toBe(rankValue('5'));
  });

  it('returns A value for Q-K-A', () => {
    const val = straightValue([card('Q'), card('K', 'clubs'), card('A', 'diamonds')]);
    expect(val).toBe(rankValue('A'));
  });

  it('returns low value for A-2-3 (treated as low straight)', () => {
    const val = straightValue([card('A'), card('2', 'clubs'), card('3', 'diamonds')]);
    // A-2-3 remapped: A=-2, 2=-1, 3=0. Highest = 0
    expect(val).toBe(0);
  });

  it('A-2-3 is lower than 3-4-5', () => {
    const low = straightValue([card('A'), card('2', 'clubs'), card('3', 'diamonds')]);
    const mid = straightValue([card('3'), card('4', 'clubs'), card('5', 'diamonds')]);
    expect(low).toBeLessThan(mid);
  });
});

// ============================================================
// Paired Straight Validation
// ============================================================

describe('isValidPairedStraight', () => {
  it('accepts 3-3-4-4-5-5', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'),
      card('4', 'hearts'), card('4', 'clubs'),
      card('5', 'hearts'), card('5', 'clubs'),
    ];
    expect(isValidPairedStraight(cards)).toBe(true);
  });

  it('accepts 10-10-J-J-Q-Q-K-K', () => {
    const cards = [
      card('10', 'hearts'), card('10', 'clubs'),
      card('J', 'hearts'), card('J', 'clubs'),
      card('Q', 'hearts'), card('Q', 'clubs'),
      card('K', 'hearts'), card('K', 'clubs'),
    ];
    expect(isValidPairedStraight(cards)).toBe(true);
  });

  it('rejects 4 cards (too short)', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'),
      card('4', 'hearts'), card('4', 'clubs'),
    ];
    expect(isValidPairedStraight(cards)).toBe(false);
  });

  it('rejects odd card count', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'),
      card('4', 'hearts'), card('4', 'clubs'),
      card('5', 'hearts'),
    ];
    expect(isValidPairedStraight(cards)).toBe(false);
  });

  it('rejects non-consecutive pairs (3-3-5-5-6-6)', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'),
      card('5', 'hearts'), card('5', 'clubs'),
      card('6', 'hearts'), card('6', 'clubs'),
    ];
    expect(isValidPairedStraight(cards)).toBe(false);
  });

  it('rejects three of same rank (3-3-3-4-4-5-5) — not pairs', () => {
    const cards = [
      card('3', 'hearts'), card('3', 'clubs'), card('3', 'diamonds'),
      card('4', 'hearts'), card('4', 'clubs'),
      card('5', 'hearts'), card('5', 'clubs'),
    ];
    expect(isValidPairedStraight(cards)).toBe(false);
  });
});

// ============================================================
// Bomb Classification
// ============================================================

describe('classifyBomb', () => {
  it('classifies 3-of-a-kind as normal bomb', () => {
    const bomb = classifyBomb(cardsOfRank('7', 3))!;
    expect(bomb.type).toBe('normal');
    expect(bomb.length).toBe(3);
    expect(bomb.rankValue).toBe(rankValue('7'));
  });

  it('classifies 6-of-a-kind as normal bomb', () => {
    const bomb = classifyBomb(cardsOfRank('Q', 6))!;
    expect(bomb.type).toBe('normal');
    expect(bomb.length).toBe(6);
  });

  it('classifies 4-4-A as fours_aces bomb', () => {
    const bomb = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'), card('A', 'diamonds')
    ])!;
    expect(bomb.type).toBe('fours_aces');
    expect(bomb.length).toBe(3);
    expect(bomb.rankValue).toBe(Infinity);
  });

  it('classifies 4-4-A-A as fours_aces bomb', () => {
    const bomb = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'),
      card('A', 'diamonds'), card('A', 'spades'),
    ])!;
    expect(bomb.type).toBe('fours_aces');
    expect(bomb.length).toBe(4);
  });

  it('classifies 4-4-A-A-A-A as fours_aces bomb (6 cards)', () => {
    const bomb = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'),
      card('A', 'diamonds'), card('A', 'spades'),
      card('A', 'hearts2'), card('A', 'clubs2'),
    ])!;
    expect(bomb.type).toBe('fours_aces');
    expect(bomb.length).toBe(6);
  });

  it('classifies 2 red 10s as red10_2', () => {
    const bomb = classifyBomb([redTen('hearts'), redTen('diamonds')])!;
    expect(bomb.type).toBe('red10_2');
    expect(bomb.length).toBe(2);
  });

  it('classifies 3 red 10s as red10_3', () => {
    const bomb = classifyBomb([
      redTen('hearts'), redTen('diamonds'), redTen('hearts2')
    ])!;
    expect(bomb.type).toBe('red10_3');
    expect(bomb.length).toBe(3);
  });

  it('does NOT classify a pair as a bomb', () => {
    expect(classifyBomb([card('7', 'hearts'), card('7', 'clubs')])).toBeNull();
  });

  it('does NOT classify 4-4-4 as fours_aces (no aces)', () => {
    // 3 fours is a normal 3-of-a-kind bomb, not fours_aces
    const bomb = classifyBomb(cardsOfRank('4', 3))!;
    expect(bomb.type).toBe('normal');
  });

  it('does NOT classify 4-A-A as fours_aces (need pair of 4s)', () => {
    expect(classifyBomb([
      card('4', 'hearts'), card('A', 'clubs'), card('A', 'diamonds')
    ])).toBeNull();
  });
});

// ============================================================
// Bomb Comparison
// ============================================================

describe('compareBombs', () => {
  it('longer bomb beats shorter bomb regardless of rank', () => {
    const threeTwos = classifyBomb(cardsOfRank('2', 3))!;  // 3× 2 (highest rank)
    const fourThrees = classifyBomb(cardsOfRank('3', 4))!; // 4× 3 (lowest rank)
    expect(compareBombs(fourThrees, threeTwos)).toBeGreaterThan(0);
  });

  it('same length: higher rank wins', () => {
    const threeJacks = classifyBomb(cardsOfRank('J', 3))!;
    const threeKings = classifyBomb(cardsOfRank('K', 3))!;
    expect(compareBombs(threeKings, threeJacks)).toBeGreaterThan(0);
  });

  it('4-4-A beats any other 3-card bomb', () => {
    const foursAces = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'), card('A', 'diamonds')
    ])!;
    const threeTwos = classifyBomb(cardsOfRank('2', 3))!;
    expect(compareBombs(foursAces, threeTwos)).toBeGreaterThan(0);
  });

  it('4-4-A-A beats any other 4-card bomb', () => {
    const foursAces = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'),
      card('A', 'diamonds'), card('A', 'spades'),
    ])!;
    const fourTwos = classifyBomb(cardsOfRank('2', 4))!;
    expect(compareBombs(foursAces, fourTwos)).toBeGreaterThan(0);
  });

  it('2 red 10s is treated as 5-card tier', () => {
    const redTenBomb = classifyBomb([redTen('hearts'), redTen('diamonds')])!;
    const fourTwos = classifyBomb(cardsOfRank('2', 4))!;
    expect(compareBombs(redTenBomb, fourTwos)).toBeGreaterThan(0);
  });

  it('2 red 10s ties with 4-4-A-A-A (5-card fours_aces)', () => {
    const redTenBomb = classifyBomb([redTen('hearts'), redTen('diamonds')])!;
    const foursAces5 = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'),
      card('A', 'diamonds'), card('A', 'spades'), card('A', 'hearts2'),
    ])!;
    expect(compareBombs(redTenBomb, foursAces5)).toBe(0);
  });

  it('3 red 10s beats 4-4-A-A-A-A (6-card fours_aces)', () => {
    const redTen3 = classifyBomb([
      redTen('hearts'), redTen('diamonds'), redTen('hearts2')
    ])!;
    const foursAces6 = classifyBomb([
      card('4', 'hearts'), card('4', 'clubs'),
      card('A', 'diamonds'), card('A', 'spades'),
      card('A', 'hearts2'), card('A', 'clubs2'),
    ])!;
    expect(compareBombs(redTen3, foursAces6)).toBeGreaterThan(0);
  });

  it('3 red 10s beats any 6-of-a-kind', () => {
    const redTen3 = classifyBomb([
      redTen('hearts'), redTen('diamonds'), redTen('hearts2')
    ])!;
    const sixTwos = classifyBomb(cardsOfRank('2', 6))!;
    expect(compareBombs(redTen3, sixTwos)).toBeGreaterThan(0);
  });

  it('3 red 10s ties with itself', () => {
    const a = classifyBomb([redTen('hearts'), redTen('diamonds'), redTen('hearts2')])!;
    const b = classifyBomb([redTen('hearts'), redTen('diamonds'), redTen('hearts2')])!;
    expect(compareBombs(a, b)).toBe(0);
  });
});

// ============================================================
// canBeat (full play comparison)
// ============================================================

describe('canBeat', () => {
  // Singles
  it('higher single beats lower single', () => {
    const current = makePlay([card('5')], 'single');
    expect(canBeat([card('7')], current)).toBe(true);
  });

  it('lower single cannot beat higher single', () => {
    const current = makePlay([card('K')], 'single');
    expect(canBeat([card('J')], current)).toBe(false);
  });

  it('same rank single cannot beat same rank', () => {
    const current = makePlay([card('8')], 'single');
    expect(canBeat([card('8', 'clubs')], current)).toBe(false);
  });

  // Pairs
  it('higher pair beats lower pair', () => {
    const current = makePlay([card('6', 'hearts'), card('6', 'clubs')], 'pair');
    expect(canBeat([card('9', 'hearts'), card('9', 'clubs')], current)).toBe(true);
  });

  // Straights
  it('higher straight beats lower straight of same length', () => {
    const current = makePlay([card('3'), card('4', 'clubs'), card('5', 'diamonds')], 'straight');
    const higher = [card('4'), card('5', 'clubs'), card('6', 'diamonds')];
    expect(canBeat(higher, current)).toBe(true);
  });

  it('different length straight cannot beat', () => {
    const current = makePlay([card('3'), card('4', 'clubs'), card('5', 'diamonds')], 'straight');
    const longer = [card('6'), card('7', 'clubs'), card('8', 'diamonds'), card('9', 'spades')];
    expect(canBeat(longer, current)).toBe(false);
  });

  // Bombs beat non-bombs
  it('bomb beats any single', () => {
    const current = makePlay([card('2')], 'single'); // 2 is highest single
    const bomb = cardsOfRank('3', 3); // lowest 3-of-a-kind
    expect(canBeat(bomb, current)).toBe(true);
  });

  it('bomb beats any pair', () => {
    const current = makePlay([card('2', 'hearts'), card('2', 'clubs')], 'pair');
    expect(canBeat(cardsOfRank('3', 3), current)).toBe(true);
  });

  it('bomb beats any straight', () => {
    const current = makePlay(
      [card('10'), card('J', 'clubs'), card('Q', 'diamonds'), card('K', 'spades'), card('A', 'hearts2')],
      'straight',
    );
    expect(canBeat(cardsOfRank('3', 3), current)).toBe(true);
  });

  // Bombs vs bombs
  it('larger bomb beats smaller bomb', () => {
    const current = makePlay(cardsOfRank('K', 3), 'bomb');
    expect(canBeat(cardsOfRank('A', 3), current)).toBe(true);
  });

  it('4-of-a-kind beats 3-of-a-kind', () => {
    const current = makePlay(cardsOfRank('2', 3), 'bomb');
    expect(canBeat(cardsOfRank('3', 4), current)).toBe(true);
  });

  // Cannot play non-bomb of wrong format
  it('single cannot beat pair', () => {
    const current = makePlay([card('3', 'hearts'), card('3', 'clubs')], 'pair');
    expect(canBeat([card('A')], current)).toBe(false);
  });

  it('pair cannot beat single', () => {
    const current = makePlay([card('3')], 'single');
    expect(canBeat([card('A', 'hearts'), card('A', 'clubs')], current)).toBe(false);
  });
});

// ============================================================
// Defuse Validation
// ============================================================

describe('isValidDefuse', () => {
  it('2 black 10s defuse 2 red 10s', () => {
    const bomb = classifyBomb([redTen('hearts'), redTen('diamonds')])!;
    const defuse = [blackTen('clubs'), blackTen('spades')];
    expect(isValidDefuse(defuse, bomb)).toBe(true);
  });

  it('3 black 10s defuse 3 red 10s', () => {
    const bomb = classifyBomb([redTen('hearts'), redTen('diamonds'), redTen('hearts2')])!;
    const defuse = [blackTen('clubs'), blackTen('spades'), blackTen('clubs2')];
    expect(isValidDefuse(defuse, bomb)).toBe(true);
  });

  it('2 black 10s cannot defuse 3 red 10s', () => {
    const bomb = classifyBomb([redTen('hearts'), redTen('diamonds'), redTen('hearts2')])!;
    const defuse = [blackTen('clubs'), blackTen('spades')];
    expect(isValidDefuse(defuse, bomb)).toBe(false);
  });

  it('cannot defuse a normal bomb', () => {
    const bomb = classifyBomb(cardsOfRank('K', 3))!;
    const defuse = [blackTen('clubs'), blackTen('spades'), blackTen('clubs2')];
    expect(isValidDefuse(defuse, bomb)).toBe(false);
  });

  it('red 10s cannot defuse red 10s', () => {
    const bomb = classifyBomb([redTen('hearts'), redTen('diamonds')])!;
    const defuse = [redTen('hearts2'), redTen('diamonds')];
    expect(isValidDefuse(defuse, bomb)).toBe(false);
  });
});

describe('defuseResultFormat', () => {
  it('defusing 2 red 10s continues as pairs', () => {
    expect(defuseResultFormat('red10_2')).toBe('pair');
  });

  it('defusing 3 red 10s continues as bomb', () => {
    expect(defuseResultFormat('red10_3')).toBe('bomb');
  });
});
