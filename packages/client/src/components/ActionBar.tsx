import type { ActionType, Card } from '@red10/shared';

interface ActionBarProps {
  validActions: ActionType[];
  isMyTurn: boolean;
  selectedCards: Card[];
  onPlay: () => void;
  onPass: () => void;
  currentPlayerName?: string;
}

function ActionBar({
  validActions,
  isMyTurn,
  selectedCards,
  onPlay,
  onPass,
  currentPlayerName,
}: ActionBarProps) {
  const canPlay = isMyTurn && validActions.includes('play') && selectedCards.length > 0;
  const canPass = isMyTurn && validActions.includes('pass');

  return (
    <div className="flex items-center justify-center gap-4 py-3 px-4 bg-green-950/80">
      {isMyTurn ? (
        <>
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
              canPlay
                ? 'bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            Play{selectedCards.length > 0 ? ` (${selectedCards.length})` : ''}
          </button>
          <button
            onClick={onPass}
            disabled={!canPass}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
              canPass
                ? 'bg-gray-500 hover:bg-gray-400 text-white cursor-pointer'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Pass
          </button>
        </>
      ) : (
        <span className="text-green-300 text-sm">
          {currentPlayerName
            ? `Waiting for ${currentPlayerName}...`
            : 'Waiting...'}
        </span>
      )}
    </div>
  );
}

export default ActionBar;
