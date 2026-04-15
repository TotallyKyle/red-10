import type { ActionType, Card, ChaGoState } from '@red10/shared';

interface ActionBarProps {
  validActions: ActionType[];
  isMyTurn: boolean;
  selectedCards: Card[];
  onPlay: () => void;
  onPass: () => void;
  onDefuse: () => void;
  onCha: () => void;
  onGoCha: () => void;
  onDeclineCha: () => void;
  currentPlayerName?: string;
  chaGoState?: ChaGoState | null;
}

const CHA_GO_PHASE_LABELS: Record<string, string> = {
  waiting_cha: 'Waiting for Cha...',
  waiting_go: 'Waiting for Go...',
  waiting_final_cha: 'Waiting for Final Cha...',
};

function ActionBar({
  validActions,
  isMyTurn,
  selectedCards,
  onPlay,
  onPass,
  onDefuse,
  onCha,
  onGoCha,
  onDeclineCha,
  currentPlayerName,
  chaGoState,
}: ActionBarProps) {
  const canPlay = isMyTurn && validActions.includes('play') && selectedCards.length > 0;
  const canPass = isMyTurn && validActions.includes('pass');
  const canDefuse = validActions.includes('defuse');
  const canCha = validActions.includes('cha');
  const canGoCha = validActions.includes('go_cha');
  const canDeclineCha = validActions.includes('decline_cha');

  // Show action buttons when it's your turn OR when you can do an interrupt action
  const showActions = isMyTurn || canDefuse || canCha || canGoCha || canDeclineCha;

  return (
    <div className="flex items-center justify-center gap-4 py-3 px-4 bg-green-950/80">
      {/* Cha-go status label */}
      {chaGoState && (
        <span className="text-amber-300 text-sm font-semibold mr-2">
          Cha-Go [{chaGoState.triggerRank}]: {CHA_GO_PHASE_LABELS[chaGoState.phase] ?? chaGoState.phase}
        </span>
      )}

      {showActions ? (
        <>
          {canGoCha && (
            <button
              onClick={onGoCha}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer animate-pulse"
            >
              GO-CHA!
            </button>
          )}
          {canCha && (
            <button
              onClick={onCha}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-orange-600 hover:bg-orange-500 text-white cursor-pointer"
            >
              CHA!
            </button>
          )}
          {canDeclineCha && (
            <button
              onClick={onDeclineCha}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-gray-500 hover:bg-gray-400 text-white cursor-pointer"
            >
              Decline
            </button>
          )}
          {validActions.includes('play') && !chaGoState && (
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
          {/* During waiting_go, play button for go card */}
          {validActions.includes('play') && chaGoState?.phase === 'waiting_go' && (
            <button
              onClick={onPlay}
              disabled={!canPlay}
              className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
                canPlay
                  ? 'bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              Go{selectedCards.length > 0 ? ` (${selectedCards.length})` : ''}
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
