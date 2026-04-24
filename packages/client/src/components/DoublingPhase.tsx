import { useState, useCallback } from 'react';
import type { ClientGameView, Card as CardType, DoublingState, ClientPlayerView } from '@red10/shared';
import { RANK_ORDER, SUIT_DISPLAY } from '@red10/shared';
import Card from './Card.js';
import { useViewportWidth } from '../hooks/useViewport.js';

const CARD_WIDTH: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 40, md: 56, lg: 80, xl: 96,
};

/**
 * Shared hand-layout math — same algorithm as PlayerHand's. Keeps the doubling
 * phase hand visually consistent with the in-game hand and guarantees all
 * cards fit the mobile viewport.
 */
function getDoublingHandLayout(cardCount: number, viewportWidth: number) {
  const isCompact = viewportWidth < 1024;

  if (isCompact) {
    const available = Math.max(280, viewportWidth - 32);
    const widths: Array<'xl' | 'lg' | 'md' | 'sm'> = ['xl', 'lg', 'md', 'sm'];
    let size: 'sm' | 'md' | 'lg' | 'xl' = 'sm';
    for (const candidate of widths) {
      const w = CARD_WIDTH[candidate];
      const minExposed = Math.max(18, Math.floor(w * 0.35));
      const required = w + Math.max(0, cardCount - 1) * minExposed;
      if (required <= available) { size = candidate; break; }
    }
    const w = CARD_WIDTH[size];
    if (cardCount <= 1) return { size, withinOverlap: 0, groupGap: 0 };
    const minExposed = Math.max(18, Math.floor(w * 0.35));
    let step = Math.floor((available - w) / (cardCount - 1));
    if (step > w) step = w;
    if (step < minExposed) step = minExposed;
    const overlap = step - w;
    return { size, withinOverlap: overlap, groupGap: overlap };
  }

  // Desktop (≥1024).
  if (cardCount <= 9) return { size: 'lg' as const, withinOverlap: -14, groupGap: 10 };
  return { size: 'md' as const, withinOverlap: -18, groupGap: 6 };
}

interface DoublingPhaseProps {
  gameView: ClientGameView;
  mySocketId: string;
  onDeclareDouble: (bombCards?: CardType[]) => void;
  onSkipDouble: () => void;
  onDeclareQuadruple: () => void;
  onSkipQuadruple: () => void;
}

// ---- Sort & group helpers (same logic as PlayerHand) ----

const SUIT_ORDER: Record<string, number> = {
  hearts: 0, hearts2: 1, diamonds: 2, clubs: 3, clubs2: 4, spades: 5,
};

function sortCards(cards: CardType[]): CardType[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
  });
}

function groupByRank(sorted: CardType[]): CardType[][] {
  const groups: CardType[][] = [];
  let currentGroup: CardType[] = [];
  for (const card of sorted) {
    if (currentGroup.length > 0 && currentGroup[0].rank !== card.rank) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(card);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}

/** Mirror of PlayerHand's splitGroupsIntoRows — keep ranks intact. */
function splitGroupsIntoRows(groups: CardType[][], numRows: number): CardType[][][] {
  if (numRows <= 1) return [groups];
  const total = groups.reduce((s, g) => s + g.length, 0);
  const target = Math.ceil(total / numRows);
  const rows: CardType[][][] = Array.from({ length: numRows }, () => []);
  let rowIdx = 0;
  let running = 0;
  for (const group of groups) {
    rows[rowIdx].push(group);
    running += group.length;
    if (running >= target && rowIdx < numRows - 1) {
      rowIdx++;
      running = 0;
    }
  }
  return rows.filter((r) => r.length > 0);
}

// ---- Main Component ----

function DoublingPhase({
  gameView,
  mySocketId,
  onDeclareDouble,
  onSkipDouble,
  onDeclareQuadruple,
  onSkipQuadruple,
}: DoublingPhaseProps) {
  const [selectedBombCards, setSelectedBombCards] = useState<CardType[]>([]);
  const doubling = gameView.doubling;
  if (!doubling) return null;

  const isMyTurn = doubling.currentBidderId === mySocketId;
  const myTeam = gameView.myTeam;
  const isQuadruplePhase = doubling.isDoubled;
  const currentBidder = gameView.players.find((p) => p.id === doubling.currentBidderId);

  const handleToggleBombCard = useCallback((card: CardType) => {
    setSelectedBombCards((prev) => {
      const exists = prev.some((c) => c.id === card.id);
      if (exists) return prev.filter((c) => c.id !== card.id);
      return [...prev, card];
    });
  }, []);

  const handleDouble = useCallback(() => {
    if (myTeam === 'black10') {
      if (selectedBombCards.length === 0) return;
      onDeclareDouble(selectedBombCards);
    } else {
      onDeclareDouble();
    }
    setSelectedBombCards([]);
  }, [myTeam, selectedBombCards, onDeclareDouble]);

  const handleSkip = useCallback(() => {
    if (isQuadruplePhase) {
      onSkipQuadruple();
    } else {
      onSkipDouble();
    }
  }, [isQuadruplePhase, onSkipQuadruple, onSkipDouble]);

  const sorted = sortCards(gameView.myHand);
  const groups = groupByRank(sorted);
  const selectedIds = new Set(selectedBombCards.map((c) => c.id));
  const viewportWidth = useViewportWidth();
  const splitRows = viewportWidth < 640 && sorted.length > 9 ? 2 : 1;
  const rowsOfGroups = splitGroupsIntoRows(groups, splitRows);
  const handLayout = getDoublingHandLayout(sorted.length, viewportWidth);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 via-green-900 to-emerald-950 flex flex-col items-center p-2 sm:p-8">
      {/* Header */}
      <div className="mb-3 sm:mb-6 text-center">
        <h2 className="text-xl sm:text-3xl font-black text-white mb-1 sm:mb-2">Doubling Phase</h2>
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <span className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs sm:text-sm font-bold ${
            myTeam === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-700 text-white'
          }`}>
            {myTeam === 'red10' ? 'Red 10 Team' : 'Black 10 Team'}
          </span>
          <span className="text-yellow-400 text-sm sm:text-lg font-bold">
            Stakes: x{gameView.stakeMultiplier}
          </span>
        </div>
      </div>

      {/* Player status grid */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3 mb-3 sm:mb-6 max-w-xl w-full">
        {gameView.players.map((player) => (
          <PlayerDoublingStatus
            key={player.id}
            player={player}
            doubling={doubling}
            isCurrentBidder={doubling.currentBidderId === player.id}
            isMe={player.id === mySocketId}
          />
        ))}
      </div>

      {/* Revealed bombs */}
      {doubling.revealedBombs.length > 0 && (
        <div className="mb-4 bg-green-800/40 border border-green-600/30 rounded-xl p-4 max-w-xl w-full">
          <h3 className="text-amber-400 text-sm font-bold mb-3">Revealed Bombs:</h3>
          {doubling.revealedBombs.map((bomb, i) => {
            const bombPlayer = gameView.players.find((p) => p.id === bomb.playerId);
            return (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-white text-sm font-semibold min-w-[80px]">{bombPlayer?.name}:</span>
                <div className="flex gap-1">
                  {bomb.cards.map((c) => (
                    <Card key={c.id} card={c} size="sm" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Revealed teams */}
      {doubling.teamsRevealed && (
        <div className="mb-4 bg-green-800/40 border border-green-600/30 rounded-xl p-4 max-w-xl w-full">
          <h3 className="text-amber-400 text-sm font-bold mb-2">Teams Revealed:</h3>
          <div className="flex flex-wrap gap-2">
            {gameView.players.map((player) => (
              <span
                key={player.id}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                  player.team === 'red10' ? 'bg-red-600/80 text-white' : 'bg-gray-600/80 text-white'
                }`}
              >
                {player.name}
                {player.revealedRed10Count > 0 && ` (${player.revealedRed10Count} red 10s)`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6">
        {isMyTurn && !isQuadruplePhase && (
          <div className="flex flex-col items-center gap-3">
            {myTeam === 'black10' && (
              <p className="text-emerald-300/70 text-sm text-center">
                Select bomb cards to reveal for doubling:
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleDouble}
                disabled={myTeam === 'black10' && selectedBombCards.length === 0}
                className={`px-8 py-3 rounded-xl font-bold text-base transition-all duration-200 ${
                  myTeam === 'black10' && selectedBombCards.length === 0
                    ? 'bg-green-800/40 border border-green-700/30 text-green-600/40 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 border border-red-500/30'
                }`}
              >
                Double!
              </button>
              <button
                onClick={handleSkip}
                className="px-8 py-3 rounded-xl font-bold text-base transition-all duration-200 bg-green-700/40 hover:bg-green-600/40 border border-green-600/30 text-green-300"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {isMyTurn && isQuadruplePhase && (
          <div className="flex gap-3">
            <button
              onClick={onDeclareQuadruple}
              className="px-8 py-3 rounded-xl font-bold text-base transition-all duration-200 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white shadow-lg shadow-purple-600/30 border border-purple-400/30 animate-pulse"
            >
              Quadruple!
            </button>
            <button
              onClick={handleSkip}
              className="px-8 py-3 rounded-xl font-bold text-base transition-all duration-200 bg-green-700/40 hover:bg-green-600/40 border border-green-600/30 text-green-300"
            >
              Skip
            </button>
          </div>
        )}

        {!isMyTurn && (
          <span className="text-emerald-300/60 text-sm">
            Waiting for {currentBidder?.name ?? 'other player'}...
          </span>
        )}
      </div>

      {/* Your Hand — proper playing cards with rank grouping */}
      <div className="w-full">
        <h3 className="text-emerald-300/70 text-xs font-semibold uppercase tracking-wider text-center mb-3">
          Your Hand
        </h3>
        <div className="flex flex-col items-center pb-2 px-2 sm:px-4 w-full gap-1">
          {rowsOfGroups.map((rowGroups, rowIdx) => {
            const rowCardCount = rowGroups.reduce((s, g) => s + g.length, 0);
            const rowLayout =
              rowsOfGroups.length > 1
                ? getDoublingHandLayout(rowCardCount, viewportWidth)
                : handLayout;
            return (
              <div key={rowIdx} className="flex items-end max-w-full">
                {rowGroups.map((group, groupIdx) => (
                  <div
                    key={group[0].rank + '-' + rowIdx + '-' + groupIdx}
                    className="flex items-end"
                    style={{ marginLeft: groupIdx === 0 ? 0 : `${rowLayout.groupGap}px` }}
                  >
                    {group.map((card, cardIdx) => {
                      const isSelected = selectedIds.has(card.id);
                      // For black10 team, clicking selects for bomb reveal
                      const canSelect = isMyTurn && !isQuadruplePhase && myTeam === 'black10';
                      return (
                        <div
                          key={card.id}
                          className="transition-all duration-150 hover:-translate-y-2 hover:z-50"
                          style={{
                            marginLeft: cardIdx === 0 ? 0 : `${rowLayout.withinOverlap}px`,
                            zIndex: cardIdx,
                          }}
                        >
                          <Card
                            card={card}
                            selected={isSelected}
                            onClick={canSelect ? () => handleToggleBombCard(card) : undefined}
                            size={rowLayout.size}
                          />
                        </div>
                      );
                    })}

                    {/* Rank count badge — hidden on mobile (preserves the uniform-step layout). */}
                    {group.length >= 2 && (
                      <div
                        className={`hidden sm:flex relative -ml-3 mb-1 z-50 items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shadow-sm ${
                          group.length >= 3
                            ? 'bg-amber-500 text-black'
                            : 'bg-green-600/80 text-white'
                        }`}
                        title={group.length >= 3 ? `${group.length}× bomb!` : `${group.length}× pair`}
                      >
                        {group.length}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Player Status Badge ----

function PlayerDoublingStatus({
  player,
  doubling,
  isCurrentBidder,
  isMe,
}: {
  player: ClientPlayerView;
  doubling: DoublingState;
  isCurrentBidder: boolean;
  isMe: boolean;
}) {
  let status = 'Waiting';
  let statusColor = 'text-green-500/50';

  if (isCurrentBidder) {
    status = 'Bidding...';
    statusColor = 'text-yellow-400';
  } else if (doubling.revealedBombs.some((b) => b.playerId === player.id)) {
    status = 'Doubled (bomb)';
    statusColor = 'text-red-400';
  } else if (player.revealedRed10Count > 0 && doubling.isDoubled) {
    status = `${player.revealedRed10Count} red 10s`;
    statusColor = 'text-red-400';
  }

  const isBot = player.id.startsWith('bot-');

  return (
    <div className={`rounded-xl p-2.5 text-center transition-all ${
      isCurrentBidder
        ? 'bg-yellow-900/30 ring-2 ring-yellow-400/60'
        : 'bg-green-800/30 border border-green-700/20'
    }`}>
      <div className={`text-sm font-semibold ${isMe ? 'text-emerald-300' : 'text-white'}`}>
        {isBot && <span className="mr-0.5">{'\u{1F916}'}</span>}
        {player.name}{isMe ? ' (You)' : ''}
      </div>
      {player.team && (
        <div className={`text-[10px] font-bold uppercase ${player.team === 'red10' ? 'text-red-400' : 'text-gray-400'}`}>
          {player.team === 'red10' ? 'Red' : 'Black'}
        </div>
      )}
      <div className={`text-xs mt-0.5 ${statusColor}`}>{status}</div>
    </div>
  );
}

export default DoublingPhase;
