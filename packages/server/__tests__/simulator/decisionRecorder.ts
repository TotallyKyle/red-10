import type { GameEngine } from '../../src/game/GameEngine.js';
import type { Card, ActionType, GameResult, PlayFormat } from '@red10/shared';
import { RANK_ORDER, detectFormat } from '@red10/shared';
import type { PlayerStrategy } from './strategies.js';

export interface DecisionContext {
  gameIndex: number;
  decisionIndex: number;
  /**
   * 0-based round index within the game. Rounds are delimited by lastPlay
   * resetting to null after a winner takes a round. Doubling-phase decisions
   * use roundIndex = -1.
   */
  roundIndex: number;
  playerId: string;
  seatIndex: number;
  myTeam: 'red10' | 'black10' | null;
  teamsRevealed: boolean;
  handSize: number;
  handRankCounts: number[];
  isLeading: boolean;
  currentFormat: PlayFormat | null;
  lastPlayLength: number;
  opponentMinHandSize: number;
  activeOpponents: number;
  teammateMinHandSize: number;
  phase: 'doubling' | 'playing';
  /** Leader of the current round at decision time (or empty in doubling phase). */
  currentLeaderId: string;
}

export interface DecisionMade {
  action: ActionType;
  cards: Card[];
  playedFormat: PlayFormat | null;
}

export interface DecisionOutcome {
  finalPosition: number | null;
  gamePayout: number;
  ownDecisionsUntilOut: number | null;
  wonRound: boolean | null;
}

export interface DecisionRecord {
  context: DecisionContext;
  decision: DecisionMade;
  outcome?: DecisionOutcome;
}

interface InFlightRecord {
  context: DecisionContext;
  decision: DecisionMade;
}

function buildHandRankCounts(hand: Card[]): number[] {
  const counts = new Array<number>(13).fill(0);
  for (const card of hand) {
    const r = RANK_ORDER[card.rank];
    if (r !== undefined) counts[r]++;
  }
  return counts;
}

function captureContext(
  engine: GameEngine,
  playerId: string,
  phase: 'doubling' | 'playing',
  gameIndex: number,
  decisionIndex: number,
  roundIndex: number,
): DecisionContext {
  const state = engine.getState();
  const player = state.players.find(p => p.id === playerId);
  const seatIndex = player?.seatIndex ?? 0;
  const myTeam = player?.team ?? null;
  const hand = player?.hand ?? [];
  const handSize = hand.length;
  const handRankCounts = buildHandRankCounts(hand);

  const teamsRevealed = state.doubling?.teamsRevealed ?? false;

  const round = state.round;
  const currentFormat = round?.currentFormat ?? null;
  const lastPlayLength = round?.lastPlay?.length ?? 0;
  const currentLeaderId = round?.leaderId ?? '';

  // Leading: no lastPlay set AND player is the leader
  const isLeading =
    phase === 'playing' &&
    round !== null &&
    round.lastPlay === null &&
    round.leaderId === playerId;

  // Compute opponent/teammate hand sizes using known team
  // (player always knows their own team even if not publicly revealed)
  let opponentMinHandSize = 99;
  let teammateMinHandSize = 99;
  let activeOpponents = 0;

  for (const p of state.players) {
    if (p.id === playerId) continue;
    if (p.isOut) continue;

    if (myTeam === null) {
      // Treat all others as opponents
      activeOpponents++;
      if (p.handSize < opponentMinHandSize) opponentMinHandSize = p.handSize;
    } else if (p.team === myTeam) {
      if (p.handSize < teammateMinHandSize) teammateMinHandSize = p.handSize;
    } else {
      activeOpponents++;
      if (p.handSize < opponentMinHandSize) opponentMinHandSize = p.handSize;
    }
  }

  return {
    gameIndex,
    decisionIndex,
    roundIndex,
    playerId,
    seatIndex,
    myTeam,
    teamsRevealed,
    handSize,
    handRankCounts,
    isLeading,
    currentFormat,
    lastPlayLength,
    opponentMinHandSize,
    activeOpponents,
    teammateMinHandSize,
    phase,
    currentLeaderId,
  };
}

function normalizeAction(
  raw:
    | { action: 'double'; bombCards?: Card[] }
    | { action: 'skip' }
    | { action: 'quadruple' }
    | { action: 'skip_quadruple' }
    | { action: 'play'; cards: Card[] }
    | { action: 'pass' }
    | { action: 'cha'; cards: Card[] }
    | { action: 'go_cha'; cards: Card[] }
    | { action: 'decline_cha' }
    | { action: 'defuse'; cards: Card[] },
): DecisionMade {
  const cards: Card[] =
    'cards' in raw && raw.cards ? raw.cards :
    'bombCards' in raw && raw.bombCards ? raw.bombCards :
    [];

  // ActionType doesn't include 'skip' or 'skip_quadruple' per shared types,
  // but the PlayerStrategy interface returns them. Map to the closest ActionType.
  // 'skip' maps to 'skip_double'; 'skip_quadruple' stays as is if present.
  // Checking the actual ActionType union: play|pass|cha|go_cha|decline_cha|double|quadruple|skip_double|defuse
  let action: ActionType;
  if (raw.action === 'skip') {
    action = 'skip_double';
  } else if (raw.action === 'skip_quadruple') {
    // Not in ActionType, treat as skip_double
    action = 'skip_double';
  } else {
    action = raw.action as ActionType;
  }

  const playedFormat =
    action === 'play' && cards.length > 0 ? (detectFormat(cards) ?? null) : null;

  return { action, cards, playedFormat };
}

function computeWonRound(records: InFlightRecord[]): (boolean | null)[] {
  // For each round (grouped by roundIndex), the last 'play' action in
  // playing phase is the round winner. roundIndex is set by the wrapper
  // based on engine state — same player winning two rounds in a row gets
  // distinct roundIndex values, so we can't use leaderId alone.
  const wonRound: (boolean | null)[] = records.map(r =>
    r.decision.action === 'play' && r.context.phase === 'playing' ? false : null,
  );

  // Map roundIndex -> last play record index in that round
  const lastPlayByRound = new Map<number, number>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.decision.action !== 'play' || r.context.phase !== 'playing') continue;
    if (r.context.roundIndex < 0) continue;
    lastPlayByRound.set(r.context.roundIndex, i);
  }

  for (const idx of lastPlayByRound.values()) {
    wonRound[idx] = true;
  }

  return wonRound;
}

interface InFlightGame {
  gameIndex: number;
  records: InFlightRecord[];
  /** Current round index within this game. -1 until first playing-phase decision. */
  roundIndex: number;
  /** Whether the last playing-phase decision we saw had a non-null lastPlay. */
  prevLastPlayWasNonNull: boolean;
}

export class DecisionRecorder {
  // Map from engine instance to in-flight decisions for that game
  private inFlight = new Map<GameEngine, InFlightGame>();
  private finalized: DecisionRecord[] = [];
  private gameCounter = 0;

  wrap(inner: PlayerStrategy): PlayerStrategy {
    const recorder = this;

    function getOrCreateFlight(engine: GameEngine): InFlightGame {
      if (!recorder.inFlight.has(engine)) {
        recorder.inFlight.set(engine, {
          gameIndex: recorder.gameCounter++,
          records: [],
          roundIndex: -1,
          prevLastPlayWasNonNull: false,
        });
      }
      return recorder.inFlight.get(engine)!;
    }

    return {
      name: inner.name,

      decideDoubling(engine: GameEngine, playerId: string) {
        const flight = getOrCreateFlight(engine);
        const decisionIndex = flight.records.length;
        const context = captureContext(engine, playerId, 'doubling', flight.gameIndex, decisionIndex, -1);
        const result = inner.decideDoubling(engine, playerId);
        const decision = normalizeAction(result);
        flight.records.push({ context, decision });
        return result;
      },

      decidePlay(engine: GameEngine, playerId: string) {
        const flight = getOrCreateFlight(engine);
        const decisionIndex = flight.records.length;

        // Detect new round: lastPlay is null at decision time AND either this is
        // the first playing-phase decision OR the previous decision had a non-null
        // lastPlay (meaning the prior round just ended).
        const lastPlayIsNull = engine.getState().round?.lastPlay === null;
        if (lastPlayIsNull && (flight.roundIndex < 0 || flight.prevLastPlayWasNonNull)) {
          flight.roundIndex++;
        }

        const context = captureContext(engine, playerId, 'playing', flight.gameIndex, decisionIndex, flight.roundIndex);
        const result = inner.decidePlay(engine, playerId);
        const decision = normalizeAction(result);
        flight.records.push({ context, decision });

        // Update transition tracker AFTER the decision, based on engine state.
        // The decision may have changed lastPlay (e.g., via play action), but we
        // can't observe that here without the simulator applying the action — so
        // we use the pre-decision state. The next decision will see the updated
        // state and detect the round transition correctly.
        flight.prevLastPlayWasNonNull = !lastPlayIsNull;
        return result;
      },
    };
  }

  getRecords(): readonly DecisionRecord[] {
    return this.finalized;
  }

  finalizeGame(engine: GameEngine, gameResult: GameResult | null): void {
    const flight = this.inFlight.get(engine);
    if (!flight) return;

    const state = engine.getState();
    const { records } = flight;

    const wonRoundFlags = computeWonRound(records);

    const finalized: DecisionRecord[] = records.map((r, i) => {
      const { playerId } = r.context;

      // finalPosition: from state.players
      const playerState = state.players.find(p => p.id === playerId);
      const finalPosition = playerState?.finishOrder ?? null;

      // gamePayout
      const gamePayout = gameResult?.payouts[playerId] ?? 0;

      // ownDecisionsUntilOut: count own future decisions after this one
      let ownDecisionsUntilOut: number | null;
      if (finalPosition === null) {
        ownDecisionsUntilOut = null;
      } else {
        let count = 0;
        for (let j = i + 1; j < records.length; j++) {
          if (records[j].context.playerId === playerId) count++;
        }
        ownDecisionsUntilOut = count;
      }

      const wonRound = wonRoundFlags[i];

      return {
        context: r.context,
        decision: r.decision,
        outcome: {
          finalPosition,
          gamePayout,
          ownDecisionsUntilOut,
          wonRound,
        },
      };
    });

    this.finalized.push(...finalized);
    this.inFlight.delete(engine);
  }

  size(): number {
    return this.finalized.length;
  }
}
