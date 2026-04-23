import { useState, useRef, useCallback, useEffect } from 'react';
import type { Card as CardType } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';
import Card from './Card.js';
import { useViewportWidth } from '../hooks/useViewport.js';

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

/** Card width (in px) for each size variant, so we can reason about fit. */
const CARD_WIDTH: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 40,  // w-10
  md: 56,  // w-14
  lg: 80,  // w-20
  xl: 96,  // w-24
};

interface HandLayout {
  size: 'sm' | 'md' | 'lg' | 'xl';
  /** Step between adjacent cards in the SAME rank group, in px (usually negative). */
  withinOverlap: number;
  /** Extra left margin at the start of a NEW rank group, in px. Visual separator. */
  groupGap: number;
}

/**
 * Choose card size + overlap so the whole hand visually fits the viewport.
 *
 * Mobile sizing picks the largest card size where the entire hand (counting
 * both within-group overlap and between-group gaps) fits the available width,
 * so the last card is never clipped.
 */
function getHandLayout(cardCount: number, numGroups: number, viewportWidth: number): HandLayout {
  const isMobile = viewportWidth < 640;

  if (isMobile) {
    // Leave ~20px of side padding total so nothing clips at the viewport edge.
    const available = Math.max(280, viewportWidth - 20);

    // Pick the largest card size that still leaves each card with enough
    // exposed width to tap reliably. md (56px) fits up to 13 cards on a
    // 375px phone, so we only fall back to sm on unusually wide hands.
    const size: 'sm' | 'md' | 'lg' | 'xl' =
      cardCount <= 5 ? 'xl' :
      cardCount <= 7 ? 'lg' :
      cardCount <= 13 ? 'md' :
      'sm';

    const w = CARD_WIDTH[size];

    if (cardCount <= 1) {
      // Single card — no overlap needed. Keep group gap at 0 so step logic
      // doesn't accidentally shift the card offscreen.
      return { size, withinOverlap: 0, groupGap: 0 };
    }

    // Uniform step between every consecutive card (treat within-group and
    // between-group transitions the same). This lets the formula below
    // reason about the whole hand in one calculation.
    //   total = w + (cardCount - 1) * step
    // We want total ≤ available, so:
    //   step ≤ (available - w) / (cardCount - 1)
    // Also: don't SPREAD cards (step ≤ w) and always show enough card to tap
    // (step ≥ minExposed scaled to card width).
    const minExposed = Math.max(18, Math.floor(w * 0.35));
    let step = Math.floor((available - w) / (cardCount - 1));
    if (step > w) step = w;
    if (step < minExposed) step = minExposed;

    const overlap = step - w; // negative on mobile — cards overlap
    return { size, withinOverlap: overlap, groupGap: overlap };
  }

  // Desktop: roomy sizing that preserves the original feel.
  if (cardCount <= 6) {
    return { size: 'xl', withinOverlap: -10, groupGap: 14 };
  }
  if (cardCount <= 9) {
    return { size: 'lg', withinOverlap: -12, groupGap: 10 };
  }
  if (cardCount <= 13) {
    return { size: 'lg', withinOverlap: -16, groupGap: 8 };
  }
  return { size: 'md', withinOverlap: -18, groupGap: 6 };
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
  const viewportWidth = useViewportWidth();
  const { size, withinOverlap, groupGap } = getHandLayout(
    cards.length,
    groups.length,
    viewportWidth,
  );

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
    <div className="flex justify-center items-end pb-3 px-2 sm:px-4 w-full">
      <div className="flex items-end max-w-full">
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

            {/* Rank count badge for multiples — hidden on mobile (would eat
                the width budget and the sort-grouping already makes it
                obvious which cards are paired/tripled). */}
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
    </div>
  );
}

export default PlayerHand;
