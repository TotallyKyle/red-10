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

function sortCards(cards: CardType[]): CardType[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
  });
}

function PlayerHand({ cards, selectedCards, onToggleCard }: PlayerHandProps) {
  const sorted = sortCards(cards);
  const selectedIds = new Set(selectedCards.map((c) => c.id));

  // Calculate overlap based on card count for mobile
  const overlapMobile = cards.length > 10 ? -18 : -14;
  const overlapDesktop = -20;

  return (
    <div className="flex justify-center items-end pb-2 px-2 sm:px-0">
      <div className="flex" style={{ gap: '0px' }}>
        {sorted.map((card, index) => (
          <div
            key={card.id}
            className="transition-transform duration-150 hover:scale-110 hover:-translate-y-1 hover:z-50"
            style={{
              marginLeft: index === 0 ? 0 : undefined,
              zIndex: index,
            }}
          >
            {/* Desktop card */}
            <div
              className="hidden sm:block"
              style={{ marginLeft: index === 0 ? 0 : `${overlapDesktop}px` }}
            >
              <Card
                card={card}
                selected={selectedIds.has(card.id)}
                onClick={() => onToggleCard(card)}
                size="md"
              />
            </div>
            {/* Mobile card */}
            <div
              className="sm:hidden"
              style={{ marginLeft: index === 0 ? 0 : `${overlapMobile}px` }}
            >
              <Card
                card={card}
                selected={selectedIds.has(card.id)}
                onClick={() => onToggleCard(card)}
                size="sm"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PlayerHand;
