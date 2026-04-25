import { useMemo } from 'react';
import type { ActionType, Card, ChaGoState, RoundInfo, PlayFormat } from '@red10/shared';
import { detectFormat, canBeat, RANK_DISPLAY } from '@red10/shared';

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
  round?: RoundInfo | null;
  errorMessage?: string | null;
}

const CHA_GO_PHASE_LABELS: Record<string, string> = {
  waiting_cha: 'Waiting for Cha...',
  waiting_go: 'Waiting for Go...',
  waiting_final_cha: 'Waiting for Final Cha...',
};

const FORMAT_HINTS: Record<PlayFormat, string> = {
  single: 'a single card',
  pair: 'a pair',
  straight: 'a straight',
  paired_straight: 'a paired straight',
  bomb: 'a bomb',
};

function getPlayHint(round: RoundInfo | null): string | null {
  if (!round) return null;
  if (!round.currentFormat) return 'Play any combination to start the round';
  if (!round.lastPlay) return `Play ${FORMAT_HINTS[round.currentFormat] ?? round.currentFormat}`;

  const lastPlay = round.lastPlay;
  const format = round.currentFormat;

  if (format === 'single') {
    const rankName = RANK_DISPLAY[lastPlay.cards[0]?.rank] ?? lastPlay.cards[0]?.rank;
    return `Play a single higher than ${rankName}`;
  }
  if (format === 'pair') {
    const rankName = RANK_DISPLAY[lastPlay.cards[0]?.rank] ?? lastPlay.cards[0]?.rank;
    return `Play a pair higher than ${rankName}s`;
  }
  if (format === 'straight') {
    return `Play a ${lastPlay.cards.length}-card straight to beat it`;
  }
  if (format === 'paired_straight') {
    return `Play a ${lastPlay.cards.length / 2}-pair straight to beat it`;
  }
  if (format === 'bomb') {
    return 'Play a bigger bomb to beat it';
  }
  return null;
}

interface ValidationResult {
  isValid: boolean;
  reason: string | null;
}

function validateSelectedCards(
  selectedCards: Card[],
  round: RoundInfo | null,
): ValidationResult {
  if (selectedCards.length === 0) {
    return { isValid: false, reason: null };
  }

  // During cha-go waiting_go: must play exactly 1 card of the trigger rank
  if (round?.chaGoState?.phase === 'waiting_go') {
    const triggerRank = round.chaGoState.triggerRank;
    if (selectedCards.length === 1 && selectedCards[0].rank === triggerRank) {
      return { isValid: true, reason: null };
    }
    return { isValid: false, reason: `Must play a single ${triggerRank}` };
  }

  // During cha-go waiting_final_cha: must play a pair of the trigger rank
  if (round?.chaGoState?.phase === 'waiting_final_cha') {
    const triggerRank = round.chaGoState.triggerRank;
    if (selectedCards.length === 2 && selectedCards.every(c => c.rank === triggerRank)) {
      return { isValid: true, reason: null };
    }
    return { isValid: false, reason: `Must play a pair of ${triggerRank}s` };
  }

  const format = detectFormat(selectedCards);
  if (!format) {
    return { isValid: false, reason: 'Cards do not form a valid combination' };
  }

  // If round has no plays yet (leader position), any valid format is OK
  if (!round || !round.lastPlay) {
    return { isValid: true, reason: null };
  }

  // Check if it can beat the current play
  if (canBeat(selectedCards, round.lastPlay)) {
    return { isValid: true, reason: null };
  }

  // Provide specific feedback
  if (format === 'bomb' && round.currentFormat === 'bomb') {
    return { isValid: false, reason: 'Bomb is not big enough' };
  }
  if (format !== round.currentFormat && format !== 'bomb') {
    const expected = FORMAT_HINTS[round.currentFormat!] ?? round.currentFormat;
    return { isValid: false, reason: `Must play ${expected} (or a bomb)` };
  }
  if (selectedCards.length !== round.lastPlay.cards.length && format !== 'bomb') {
    return { isValid: false, reason: `Must play ${round.lastPlay.cards.length} cards` };
  }
  return { isValid: false, reason: 'Cards are not high enough to beat the current play' };
}

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
  round,
  errorMessage,
}: ActionBarProps) {
  // Client-side validation
  const validation = useMemo(() => {
    if (!isMyTurn || !validActions.includes('play')) {
      return { isValid: false, reason: null };
    }
    return validateSelectedCards(selectedCards, round ?? null);
  }, [selectedCards, round, isMyTurn, validActions]);

  const canPlay = isMyTurn && validActions.includes('play') && selectedCards.length > 0 && validation.isValid;
  const canPass = isMyTurn && validActions.includes('pass');
  const canDefuse = validActions.includes('defuse');
  const canCha = validActions.includes('cha');
  const canGoCha = validActions.includes('go_cha');
  const canDeclineCha = validActions.includes('decline_cha');

  // Show action buttons when it's your turn OR when you can do an interrupt action
  const showActions = isMyTurn || canDefuse || canCha || canGoCha || canDeclineCha;

  // Play hint
  const playHint = isMyTurn && validActions.includes('play') && !chaGoState
    ? getPlayHint(round ?? null)
    : null;

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-1 py-1.5 sm:py-3 px-2 sm:px-4 bg-green-950/80">
      {/* Error message */}
      {errorMessage && (
        <div className="text-red-400 text-xs sm:text-sm bg-red-900/40 px-3 py-1 rounded-lg mb-1 max-w-[90vw] text-center">
          {errorMessage}
        </div>
      )}

      {/* Validation feedback */}
      {validation.reason && selectedCards.length > 0 && (
        <div className="text-amber-400 text-[10px] sm:text-xs mb-0.5">
          {validation.reason}
        </div>
      )}

      {/* Play hint */}
      {playHint && selectedCards.length === 0 && (
        <div className="text-green-400/70 text-[10px] sm:text-xs mb-0.5">
          {playHint}
        </div>
      )}

      {/* Cha-go status label */}
      {chaGoState && (
        <span className="text-amber-300 text-xs sm:text-sm font-semibold">
          Cha-Go [{chaGoState.triggerRank}]: {CHA_GO_PHASE_LABELS[chaGoState.phase] ?? chaGoState.phase}
        </span>
      )}

      <div className="flex items-stretch sm:items-center justify-center gap-2 sm:gap-4 flex-nowrap w-full">
        {showActions ? (
          <>
            {canGoCha && (
              <button
                onClick={onGoCha}
                className="px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer animate-pulse flex-1 sm:flex-none min-w-0"
              >
                GO-CHA!
              </button>
            )}
            {canCha && (
              <button
                onClick={onCha}
                className="px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors bg-orange-600 hover:bg-orange-500 text-white cursor-pointer flex-1 sm:flex-none min-w-0"
              >
                CHA!
              </button>
            )}
            {canDeclineCha && (
              <button
                onClick={onDeclineCha}
                className="px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors bg-gray-500 hover:bg-gray-400 text-white cursor-pointer flex-1 sm:flex-none min-w-0"
              >
                Decline
              </button>
            )}
            {validActions.includes('play') && !chaGoState && (
              <button
                onClick={onPlay}
                disabled={!canPlay}
                title={!canPlay && validation.reason ? validation.reason : undefined}
                className={`px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors flex-1 sm:flex-none min-w-0 ${
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
                className={`px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors flex-1 sm:flex-none min-w-0 ${
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
                className="px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors bg-blue-600 hover:bg-blue-500 text-white cursor-pointer flex-1 sm:flex-none min-w-0"
              >
                Defuse
              </button>
            )}
            {validActions.includes('pass') && (
              <button
                onClick={onPass}
                disabled={!canPass}
                className={`px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm transition-colors flex-1 sm:flex-none min-w-0 ${
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
          <span className="text-green-300 text-xs sm:text-sm">
            {currentPlayerName
              ? `Waiting for ${currentPlayerName}...`
              : 'Waiting...'}
          </span>
        )}
      </div>
    </div>
  );
}

export default ActionBar;
