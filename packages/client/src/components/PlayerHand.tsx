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

/**
 * Split groups into N rows as evenly as possible, keeping each rank-group
 * intact. Used on narrow phones so 13 cards can be shown at a readable size
 * across two lines instead of one tight stack.
 */
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
  // Phones and tablets both use the adaptive algorithm so every card fits.
  // Only true desktops (≥1024 CSS px) fall through to the roomy fixed sizes.
  const isCompact = viewportWidth < 1024;

  if (isCompact) {
    // Leave ~32px total horizontal safety margin. This covers the hand
    // wrapper's own px-2 padding plus any parent container padding (e.g. the
    // doubling phase adds p-2 on its outer shell). Empirically the prior
    // -20 assumption clipped the rightmost cards in the doubling phase.
    const available = Math.max(280, viewportWidth - 32);

    // Pick the largest card size that still leaves room for every card to
    // show at least ~35% of its width (so each card remains tappable). Fall
    // back through xl → lg → md → sm as the hand grows.
    const widths: Array<'xl' | 'lg' | 'md' | 'sm'> = ['xl', 'lg', 'md', 'sm'];
    let size: 'sm' | 'md' | 'lg' | 'xl' = 'sm';
    for (const candidate of widths) {
      const w = CARD_WIDTH[candidate];
      const minExposed = Math.max(18, Math.floor(w * 0.35));
      const required = w + Math.max(0, cardCount - 1) * minExposed;
      if (required <= available) { size = candidate; break; }
    }

    const w = CARD_WIDTH[size];

    if (cardCount <= 1) {
      // Single card — no overlap needed.
      return { size, withinOverlap: 0, groupGap: 0 };
    }

    // Uniform step between every consecutive card (treat within-group and
    // between-group transitions the same). Keep step bounded so cards don't
    // spread apart (step ≤ w) and always show enough card to tap
    // (step ≥ minExposed).
    const minExposed = Math.max(18, Math.floor(w * 0.35));
    let step = Math.floor((available - w) / (cardCount - 1));
    if (step > w) step = w;
    if (step < minExposed) step = minExposed;

    const overlap = step - w;
    return { size, withinOverlap: overlap, groupGap: overlap };
  }

  // Desktop (≥1024): roomy sizing that preserves the original feel.
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

  // On narrow phones a 13-card hand packs so tight that ranks blur together.
  // Split into 2 rows once the hand is large enough that single-row cards would
  // be heavily occluded. Each row then lays out independently with its own
  // size/overlap, so the cards grow (e.g. md → xl) and rank labels stay legible.
  const splitRows = viewportWidth < 640 && cards.length > 9 ? 2 : 1;
  const rowsOfGroups = splitGroupsIntoRows(groups, splitRows);

  // Single-row layout (fallback and desktop/tablet path) still needs one
  // shared size/overlap calculation. For multi-row we compute per-row below.
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
    <div className="flex flex-col items-center pb-3 px-2 sm:px-4 w-full gap-1">
      {rowsOfGroups.map((rowGroups, rowIdx) => {
        // Per-row layout so each row is sized independently. On multi-row
        // phones this lets a 7+6 split use xl cards on both rows rather
        // than the single-row md squeeze.
        const rowCardCount = rowGroups.reduce((s, g) => s + g.length, 0);
        const rowLayout =
          rowsOfGroups.length > 1
            ? getHandLayout(rowCardCount, rowGroups.length, viewportWidth)
            : { size, withinOverlap, groupGap };

        return (
          <div key={rowIdx} className="flex items-end max-w-full">
            {rowGroups.map((group, groupIdx) => (
              <div
                key={group[0].rank + '-' + rowIdx + '-' + groupIdx}
                className="flex items-end"
                style={{ marginLeft: groupIdx === 0 ? 0 : `${rowLayout.groupGap}px` }}
              >
                {group.map((card, cardIdx) => {
                  const idx = globalIndex++;
                  return (
                    <div
                      key={card.id}
                      className="transition-all duration-150 hover:-translate-y-2 hover:z-50 cursor-grab active:cursor-grabbing"
                      style={{
                        marginLeft: cardIdx === 0 ? 0 : `${rowLayout.withinOverlap}px`,
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
                        size={rowLayout.size}
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
        );
      })}
    </div>
  );
}

export default PlayerHand;
