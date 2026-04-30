import { describe, it, expect } from 'vitest';
import type { Card, PlayerState } from '@red10/shared';
import { assessRaceMode, countWinners, countLosers } from '../src/bot/raceAssessment.js';

function makeHand(spec: string): Card[] {
  const suits: Card['suit'][] = ['hearts', 'diamonds', 'hearts2', 'clubs', 'spades', 'clubs2'];
  const seen: Record<string, number> = {};
  return spec.trim().split(/\s+/).map(rank => {
    const idx = (seen[rank] = (seen[rank] ?? 0) + 1) - 1;
    const suit = suits[idx];
    if (!suit) throw new Error(`Too many ${rank}s in spec`);
    const isRed = ['hearts', 'diamonds', 'hearts2'].includes(suit);
    return { id: `${suit}-${rank}-${idx}`, suit, rank: rank as Card['rank'], isRed };
  });
}

function makePlayer(
  id: string,
  team: 'red10' | 'black10' | null,
  handSize: number,
  isOut = false,
): Pick<PlayerState, 'id' | 'isOut' | 'handSize' | 'team'> {
  return { id, team, handSize, isOut };
}

describe('countWinners', () => {
  it('counts 2-singles as winners', () => {
    expect(countWinners(makeHand('2 2 5 7'))).toBe(2);
  });

  it('counts A-pair as one winner', () => {
    expect(countWinners(makeHand('A A 5 7'))).toBe(1);
  });

  it('counts a 3-bomb as one winner', () => {
    expect(countWinners(makeHand('K K K 7'))).toBe(1);
  });

  it('A-bomb (3+ aces) only counts once, not as A-pair + bomb', () => {
    expect(countWinners(makeHand('A A A 5'))).toBe(1);
  });

  it('counts 4,4,A special bomb as one winner', () => {
    expect(countWinners(makeHand('4 4 A 5 7'))).toBe(1);
  });

  it('does not double-count 4,4,A when 4s already form a normal bomb', () => {
    // 4 4 4 4 A: 4s are a 4-bomb (1 winner), no extra special-bomb credit.
    expect(countWinners(makeHand('4 4 4 4 A'))).toBe(1);
  });

  it('counts red10×2 as a winner (tens not also a regular bomb)', () => {
    // Two red 10s (hearts + diamonds) — assigned by makeHand suit order.
    const hand = makeHand('10 10 5 7');
    // Both 10s should be red (hearts, diamonds = first two suits)
    expect(hand.filter(c => c.rank === '10' && c.isRed).length).toBe(2);
    expect(countWinners(hand)).toBe(1);
  });

  it('weak hand has zero winners', () => {
    expect(countWinners(makeHand('3 4 5 6 7 8 9 J'))).toBe(0);
  });

  it('strong hand counts cumulatively', () => {
    // 2 2 A A K K K → 2 (twos) + 1 (A-pair) + 1 (K-bomb) = 4
    expect(countWinners(makeHand('2 2 A A K K K'))).toBe(4);
  });

  it('counts K-pair as a winner', () => {
    expect(countWinners(makeHand('K K 5 7'))).toBe(1);
  });

  it('counts Q-pair as a winner', () => {
    expect(countWinners(makeHand('Q Q 5 7'))).toBe(1);
  });

  it('counts both K-pair and Q-pair (two high pairs = 2 winners)', () => {
    expect(countWinners(makeHand('K K Q Q 9 7 3'))).toBe(2);
  });

  it('does not count J-pair as a winner', () => {
    // J-pair (rv 8) is below the Q threshold; can be beaten by Q-pair too easily.
    expect(countWinners(makeHand('J J 5 7'))).toBe(0);
  });

  it('K-3-bomb counts as a single bomb winner, not bomb + pair', () => {
    expect(countWinners(makeHand('K K K 5 7'))).toBe(1);
  });
});

describe('countLosers', () => {
  it('counts low-rank singletons (3-7)', () => {
    expect(countLosers(makeHand('3 4 5 6 7 K K'))).toBe(5);
  });

  it('does not count paired low cards as losers', () => {
    expect(countLosers(makeHand('3 3 5 5 7 7'))).toBe(0);
  });

  it('does not count 8 as a loser', () => {
    expect(countLosers(makeHand('8 K K'))).toBe(0);
  });

  it('counts mixed low singletons but skips paired ones', () => {
    expect(countLosers(makeHand('3 3 5 6 7 K'))).toBe(3);
  });
});

describe('assessRaceMode', () => {
  const ME = 'me';
  const me = makePlayer(ME, 'red10', 8);

  it('returns aggressive when only one opponent has >3 cards (last opponent)', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 1),
      makePlayer('opp2', 'black10', 2),
      makePlayer('opp3', 'black10', 8), // only this one is >3
      makePlayer('mate', 'red10', 5),
      makePlayer('opp4', 'black10', 0, true), // out
    ];
    const r = assessRaceMode(makeHand('3 4 5 6 7 8 9 J'), me, players);
    expect(r.mode).toBe('aggressive');
    expect(r.reason).toContain('last_opponent');
  });

  it('returns aggressive when zero opponents have >3 cards', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 1),
      makePlayer('opp2', 'black10', 2),
      makePlayer('opp3', 'black10', 3),
      makePlayer('mate', 'red10', 5),
      makePlayer('opp4', 'black10', 0, true),
    ];
    const r = assessRaceMode(makeHand('3 4 5 6 7 8 9 J'), me, players);
    expect(r.mode).toBe('aggressive');
  });

  it('returns defensive when teammate is about to exit (≤2)', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 8),
      makePlayer('opp2', 'black10', 7),
      makePlayer('opp3', 'black10', 9),
      makePlayer('mate', 'red10', 2), // teammate about to win
      makePlayer('mate2', 'red10', 6),
    ];
    const r = assessRaceMode(makeHand('A A K K K 5 6 7'), me, players);
    expect(r.mode).toBe('defensive');
    expect(r.reason).toContain('teammate_about_to_exit');
  });

  it('returns defensive when losing race (opp ≤2, my hand ≥6, < 2 winners)', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 2), // dangerous
      makePlayer('opp2', 'black10', 7),
      makePlayer('opp3', 'black10', 9),
      makePlayer('mate', 'red10', 6),
      makePlayer('mate2', 'red10', 8),
    ];
    // hand: 8 cards, 1 winner (A-pair), lots of losers
    const r = assessRaceMode(makeHand('A A 3 4 5 6 7 J'), me, players);
    expect(r.mode).toBe('defensive');
    expect(r.reason).toContain('losing_race');
  });

  it('stays aggressive when opp ≤2 but I have ≥2 winners', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 2),
      makePlayer('opp2', 'black10', 7),
      makePlayer('opp3', 'black10', 9),
      makePlayer('mate', 'red10', 6),
      makePlayer('mate2', 'red10', 8),
    ];
    // 2 (one winner) + A-pair (one winner) + K-bomb (one winner) = 3
    const r = assessRaceMode(makeHand('2 A A K K K 5 6'), me, players);
    expect(r.mode).toBe('aggressive');
  });

  it('stays aggressive when opp ≤2 but my hand is small (<6)', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 2),
      makePlayer('opp2', 'black10', 7),
      makePlayer('opp3', 'black10', 9),
      makePlayer('mate', 'red10', 6),
      makePlayer('mate2', 'red10', 8),
    ];
    const smallMe = { ...me, handSize: 5 };
    const r = assessRaceMode(makeHand('3 5 6 7 J'), smallMe, players);
    expect(r.mode).toBe('aggressive');
  });

  it('pre-reveal: with team=null on others, all are opponents', () => {
    // Pre-reveal scenario: my team is set, others' teams are null.
    const players = [
      me,
      makePlayer('p1', null, 8),
      makePlayer('p2', null, 8),
      makePlayer('p3', null, 8),
      makePlayer('p4', null, 8),
      makePlayer('p5', null, 2), // dangerous opponent
    ];
    // Big hand, weak winners, opponent close to out → defensive
    const r = assessRaceMode(makeHand('A A 3 4 5 6 7 J'), me, players);
    expect(r.mode).toBe('defensive');
    expect(r.reason).toContain('losing_race');
  });

  it('pre-reveal: no teammate-rescue (teammates list is empty)', () => {
    // My team is red10, all others are null. Even if one is at 2 cards, we
    // can't claim "teammate" until they're known.
    const players = [
      me,
      makePlayer('p1', null, 2), // could be teammate or opponent — treated as opp
      makePlayer('p2', null, 8),
      makePlayer('p3', null, 8),
      makePlayer('p4', null, 8),
      makePlayer('p5', null, 8),
    ];
    // 1 winner (A-pair), big hand, opp at 2 → defensive (losing_race), not teammate_rescue
    const r = assessRaceMode(makeHand('A A 3 4 5 6 7 J'), me, players);
    expect(r.mode).toBe('defensive');
    expect(r.reason).toContain('losing_race');
    expect(r.reason).not.toContain('teammate');
  });

  it('aggressive override beats teammate_rescue when only 1 active opp left', () => {
    // Teammate at 2 cards, but only one opponent has >3 cards. Race the last opp.
    const players = [
      me,
      makePlayer('opp1', 'black10', 1),
      makePlayer('opp2', 'black10', 2),
      makePlayer('opp3', 'black10', 8), // last active opp
      makePlayer('mate', 'red10', 2), // teammate near exit
      makePlayer('mate2', 'red10', 6),
    ];
    const r = assessRaceMode(makeHand('A A 3 4 5 6 7 J'), me, players);
    expect(r.mode).toBe('aggressive');
    expect(r.reason).toContain('last_opponent');
  });

  it('default aggressive in mid-game with no triggers', () => {
    const players = [
      me,
      makePlayer('opp1', 'black10', 7),
      makePlayer('opp2', 'black10', 8),
      makePlayer('opp3', 'black10', 6),
      makePlayer('mate', 'red10', 7),
      makePlayer('mate2', 'red10', 8),
    ];
    const r = assessRaceMode(makeHand('A K Q J 9 7 5 3'), me, players);
    expect(r.mode).toBe('aggressive');
    expect(r.reason).toContain('default');
  });
});
