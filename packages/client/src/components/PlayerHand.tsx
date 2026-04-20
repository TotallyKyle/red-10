import { useState, useRef, useCallback, useEffect } from 'react';
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
  return { size: 'md' as const, withinOverlap: -18, groupGap: 6 };
}

function PlayerHand({ cards, selectedCards, onToggleCard }: PlayerHandProps) {
  // Maintain custom card order as array of card IDs
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const dragCardId = useRef<string | null>(null);
  const dragOverCardId = useRef<string | null>(null);
  const dragStartX = useRef(0);
  const isDragging = useRef(false);

  // When cards change (new deal, card played), reconcile the order:
  // - Keep existing ordered cards in their current position
  // - Append any new cards in sorted order
  // - Remove cards that are no longer in hand
  useEffect(() => {
    const currentCardIds = new Set(cards.map((c) => c.id));
    const sorted = sortCards(cards);
    const sortedIds = sorted.map((c) => c.id);

    setOrderedIds((prev) => {
      // If no previous order or completely new hand, use sorted order
      if (prev.length === 0) return sortedIds;

      // Keep cards that still exist, in their current order
      const kept = prev.filter((id) => currentCardIds.has(id));
      const keptSet = new Set(kept);

      // Any new cards (not in previous order) get appended in sorted position
      const newCards = sortedIds.filter((id) => !keptSet.has(id));

      return [...kept, ...newCards];
    });
  }, [cards]);

  // Resolve ordered IDs to actual card objects
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const orderedCards = orderedIds
    .map((id) => cardMap.get(id))
    .filter((c): c is CardType => c !== undefined);

  // Fall back to sorted if orderedCards doesn't match
  const displayCards =
    orderedCards.length === cards.length ? orderedCards : sortCards(cards);

  const groups = groupByRank(displayCards);
  const selectedIds = new Set(selectedCards.map((c) => c.id));
  const { size, withinOverlap, groupGap } = getHandLayout(cards.length);

  // Build flat list for drag indexing
  const flatCards = groups.flat();

  const handleDragStart = useCallback(
    (e: React.DragEvent, cardId: string) => {
      dragCardId.current = cardId;
      dragStartX.current = e.clientX;
      isDragging.current = false;

      // Set drag image to be the card itself
      const target = e.currentTarget as HTMLElement;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, cardId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Only count as dragging after moving a reasonable distance
      if (Math.abs(e.clientX - dragStartX.current) > 10) {
        isDragging.current = true;
      }

      dragOverCardId.current = cardId;
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      if (!isDragging.current || !dragCardId.current || !dragOverCardId.current) return;
      if (dragCardId.current === dragOverCardId.current) return;

      setOrderedIds((prev) => {
        const fromIdx = prev.indexOf(dragCardId.current!);
        const toIdx = prev.indexOf(dragOverCardId.current!);
        if (fromIdx === -1 || toIdx === -1) return prev;

        const newOrder = [...prev];
        const [moved] = newOrder.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, moved);
        return newOrder;
      });

      dragCardId.current = null;
      dragOverCardId.current = null;
      isDragging.current = false;
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    // If we didn't actually drag (just clicked), don't do anything
    // The onClick handler will fire for card selection
    dragCardId.current = null;
    dragOverCardId.current = null;
    isDragging.current = false;
  }, []);

  const handleCardClick = useCallback(
    (card: CardType) => {
      // Only toggle selection if we weren't dragging
      if (!isDragging.current) {
        onToggleCard(card);
      }
    },
    [onToggleCard],
  );

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
                  className="transition-all duration-150 hover:-translate-y-2 hover:z-50 cursor-grab active:cursor-grabbing"
                  style={{
                    marginLeft: cardIdx === 0 ? 0 : `${withinOverlap}px`,
                    zIndex: idx,
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragOver={(e) => handleDragOver(e, card.id)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                >
                  <Card
                    card={card}
                    selected={selectedIds.has(card.id)}
                    onClick={() => handleCardClick(card)}
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
