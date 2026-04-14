import type { Card as CardType } from '@red10/shared';
import { SUIT_DISPLAY, RANK_DISPLAY } from '@red10/shared';

interface CardProps {
  card: CardType;
  selected?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-10 h-14 text-xs',
  md: 'w-14 h-20 text-sm',
  lg: 'w-20 h-28 text-base',
} as const;

function Card({ card, selected = false, faceDown = false, onClick, size = 'md' }: CardProps) {
  const sizeClass = sizeClasses[size];

  if (faceDown) {
    return (
      <div
        className={`${sizeClass} rounded-lg border-2 border-gray-500 bg-gradient-to-br from-blue-800 to-blue-950 shadow-md flex items-center justify-center cursor-default select-none`}
      >
        <div className="w-3/4 h-3/4 rounded border border-blue-600 bg-blue-900/50" />
      </div>
    );
  }

  const colorClass = card.isRed ? 'text-red-600' : 'text-gray-900';
  const suitSymbol = SUIT_DISPLAY[card.suit] ?? card.suit;
  const rankLabel = RANK_DISPLAY[card.rank] ?? card.rank;

  return (
    <div
      onClick={onClick}
      className={`${sizeClass} rounded-lg border-2 bg-white shadow-md flex flex-col justify-between p-1 select-none transition-all duration-150 ${
        selected
          ? 'border-yellow-400 ring-2 ring-yellow-300 -translate-y-2 shadow-yellow-300/40'
          : 'border-gray-300 hover:border-gray-400'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`${colorClass} font-bold leading-none`}>
        <div>{rankLabel}</div>
        <div>{suitSymbol}</div>
      </div>
      <div className={`${colorClass} text-center text-lg leading-none`}>
        {suitSymbol}
      </div>
      <div className={`${colorClass} font-bold leading-none self-end rotate-180`}>
        <div>{rankLabel}</div>
        <div>{suitSymbol}</div>
      </div>
    </div>
  );
}

export default Card;
