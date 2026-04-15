import type { ActionType, Card } from '@red10/shared';

interface ActionBarProps {
  validActions: ActionType[];
  isMyTurn: boolean;
  selectedCards: Card[];
  onPlay: () => void;
  onPass: () => void;
  onDefuse: () => void;
  currentPlayerName?: string;
}

function ActionBar({
  validActions,
  isMyTurn,
  selectedCards,
  onPlay,
  onPass,
  onDefuse,
  currentPlayerName,
}: ActionBarProps) {
  const canPlay = isMyTurn && validActions.includes('play') && selectedCards.length > 0;
  const canPass = isMyTurn && validActions.includes('pass');
  const canDefuse = validActions.includes('defuse');

  // Show action buttons when it's your turn OR when you can defuse (interrupt action)
  const showActions = isMyTurn || canDefuse;

  return (
    <div className="flex items-center justify-center gap-4 py-3 px-4 bg-green-950/80">
      {showActions ? (
        <>
          {validActions.includes('play') && (
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
          )}
          {canDefuse && (
            <button
              onClick={onDefuse}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            >
              Defuse
            </button>
          )}
          {validActions.includes('pass') && (
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
          )}
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
