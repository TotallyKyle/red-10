import type { Card as CardType } from '@red10/shared';
import { SUIT_DISPLAY, RANK_DISPLAY } from '@red10/shared';

interface CardProps {
  card: CardType;
  selected?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeDimensions = {
  sm: { w: 'w-10', h: 'h-14', rank: 'text-[10px]', suit: 'text-[9px]', center: 'text-lg', pad: 'p-0.5' },
  md: { w: 'w-14', h: 'h-20', rank: 'text-xs', suit: 'text-[10px]', center: 'text-xl', pad: 'p-1' },
  lg: { w: 'w-20', h: 'h-28', rank: 'text-sm', suit: 'text-xs', center: 'text-2xl', pad: 'p-1.5' },
  xl: { w: 'w-24', h: 'h-[136px]', rank: 'text-base', suit: 'text-sm', center: 'text-3xl', pad: 'p-2' },
} as const;

function Card({ card, selected = false, faceDown = false, onClick, size = 'md' }: CardProps) {
  const s = sizeDimensions[size];

  if (faceDown) {
    return (
      <div
        className={`${s.w} ${s.h} rounded-lg border border-gray-400/50 bg-gradient-to-br from-blue-700 via-blue-800 to-blue-950 shadow-md flex items-center justify-center cursor-default select-none overflow-hidden`}
      >
        {/* Cross-hatch pattern */}
        <div className="w-[85%] h-[85%] rounded-md border border-blue-400/30 bg-blue-900/40 flex items-center justify-center">
          <div className="text-blue-400/30 text-xs font-bold">R10</div>
        </div>
      </div>
    );
  }

  const isRed = card.isRed;
  const colorClass = isRed ? 'text-red-600' : 'text-gray-800';
  const suitSymbol = SUIT_DISPLAY[card.suit] ?? card.suit;
  const rankLabel = RANK_DISPLAY[card.rank] ?? card.rank;

  // Determine if this is a "10" card for special red 10 treatment
  const isRedTen = card.rank === '10' && isRed;

  return (
    <div
      onClick={onClick}
      className={`${s.w} ${s.h} rounded-lg bg-white shadow-md flex flex-col justify-between ${s.pad} select-none transition-all duration-150 overflow-hidden relative ${
        selected
          ? 'border-2 border-yellow-400 ring-2 ring-yellow-300/60 -translate-y-3 shadow-lg shadow-yellow-400/30'
          : 'border border-gray-300 hover:border-gray-400 hover:shadow-lg'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'} ${
        isRedTen ? 'bg-gradient-to-b from-white to-red-50' : ''
      }`}
    >
      {/* Top-left corner: rank + suit */}
      <div className={`${colorClass} font-bold leading-tight`}>
        <div className={`${s.rank} leading-none`}>{rankLabel}</div>
        <div className={`${s.suit} leading-none -mt-px`}>{suitSymbol}</div>
      </div>

      {/* Center suit symbol — large and prominent */}
      <div className={`${colorClass} ${s.center} font-normal leading-none text-center flex-1 flex items-center justify-center`}>
        {suitSymbol}
      </div>

      {/* Bottom-right corner: rank + suit (inverted) */}
      <div className={`${colorClass} font-bold leading-tight self-end rotate-180`}>
        <div className={`${s.rank} leading-none`}>{rankLabel}</div>
        <div className={`${s.suit} leading-none -mt-px`}>{suitSymbol}</div>
      </div>

      {/* Red 10 special glow indicator */}
      {isRedTen && (
        <div className="absolute inset-0 rounded-lg ring-1 ring-red-300/30 pointer-events-none" />
      )}
    </div>
  );
}

export default Card;
