import type { Card as CardType } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';
import Card from './Card.js';

interface PlayerHandProps {
  cards: CardType[];
  selectedCards: CardType[];
  onToggleCard: (card: CardType) => void;
}

/** Suit ordering for display (group same-color suits together) */
const SUIT_ORDER: Record<string, number> = {
  hearts: 0,
  hearts2: 1,
  diamonds: 2,
  clubs: 3,
  clubs2: 4,
  spades: 5,
};

/**
 * Sort cards by rank first (ascending: 3 → 2), then by suit within same rank.
 * This naturally groups cards of the same rank together.
 */
function sortCards(cards: CardType[]): CardType[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
  });
}

/**
 * Group sorted cards into rank clusters for visual spacing.
 */
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
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Choose card size and overlap based on card count so the hand fits on screen.
 */
function getHandLayout(cardCount: number) {
  if (cardCount <= 6) {
    return { size: 'xl' as const, withinOverlap: -10, groupGap: 14 };
  }
  if (cardCount <= 9) {
    return { size: 'lg' as const, withinOverlap: -12, groupGap: 10 };
  }
  if (cardCount <= 13) {
    return { size: 'lg' as const, withinOverlap: -16, groupGap: 8 };
  }
  // Shouldn't happen in this game but handle gracefully
  return { size: 'md' as const, withinOverlap: -18, groupGap: 6 };
}

function PlayerHand({ cards, selectedCards, onToggleCard }: PlayerHandProps) {
  const sorted = sortCards(cards);
  const groups = groupByRank(sorted);
  const selectedIds = new Set(selectedCards.map((c) => c.id));
  const { size, withinOverlap, groupGap } = getHandLayout(cards.length);

  let globalIndex = 0;

  return (
    <div className="flex justify-center items-end pb-3 px-4">
      <div className="flex items-end">
        {groups.map((group, groupIdx) => (
          <div
            key={group[0].rank + '-' + groupIdx}
            className="flex items-end"
            style={{ marginLeft: groupIdx === 0 ? 0 : `${groupGap}px` }}
          >
            {group.map((card, cardIdx) => {
              const idx = globalIndex++;
              return (
                <div
                  key={card.id}
                  className="transition-all duration-150 hover:-translate-y-2 hover:z-50"
                  style={{
                    marginLeft: cardIdx === 0 ? 0 : `${withinOverlap}px`,
                    zIndex: idx,
                  }}
                >
                  <Card
                    card={card}
                    selected={selectedIds.has(card.id)}
                    onClick={() => onToggleCard(card)}
                    size={size}
                  />
                </div>
              );
            })}

            {/* Rank count badge for multiples */}
            {group.length >= 2 && (
              <div
                className={`relative -ml-3 mb-1 z-50 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shadow-sm ${
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
    </div>
  );
}

export default PlayerHand;
