import type { ClientGameView, Card as CardType } from '@red10/shared';
import type { GameLogEntry } from '../hooks/useSocket.js';
import PlayerHand from './PlayerHand.js';
import OtherPlayer from './OtherPlayer.js';
import PlayArea from './PlayArea.js';
import ActionBar from './ActionBar.js';
import GameLog from './GameLog.js';
import TurnTimer from './TurnTimer.js';

interface GameTableProps {
  gameView: ClientGameView;
  mySocketId: string;
  selectedCards: CardType[];
  onToggleCard: (card: CardType) => void;
  onPlay: () => void;
  onPass: () => void;
  onDefuse: () => void;
  onCha: () => void;
  onGoCha: () => void;
  onDeclineCha: () => void;
  gameLog: GameLogEntry[];
  errorMessage: string | null;
  turnStartTime: number | null;
}

/**
 * Position definitions for 5 other players around the table.
 * Index 0 = directly across (top-center), then clockwise.
 */
const POSITIONS = [
  // top center
  { top: '4%', left: '50%', transform: 'translateX(-50%)' },
  // top right
  { top: '18%', right: '4%' },
  // bottom right
  { bottom: '28%', right: '4%' },
  // bottom left
  { bottom: '28%', left: '4%' },
  // top left
  { top: '18%', left: '4%' },
] as const;

/** Mobile positions: tighter layout for small screens */
const MOBILE_POSITIONS = [
  { top: '2%', left: '50%', transform: 'translateX(-50%)' },
  { top: '15%', right: '2%' },
  { bottom: '30%', right: '2%' },
  { bottom: '30%', left: '2%' },
  { top: '15%', left: '2%' },
] as const;

function GameTable({
  gameView, mySocketId, selectedCards, onToggleCard, onPlay, onPass,
  onDefuse, onCha, onGoCha, onDeclineCha, gameLog, errorMessage, turnStartTime,
}: GameTableProps) {
  const myPlayer = gameView.players.find((p) => p.id === mySocketId);
  const mySeatIndex = myPlayer?.seatIndex ?? 0;

  // Rotate so the current player is always at the bottom.
  // Other players are ordered clockwise starting from seatIndex + 1.
  const otherPlayers = gameView.players
    .filter((p) => p.id !== mySocketId)
    .sort((a, b) => {
      const aRel = (a.seatIndex - mySeatIndex + 6) % 6;
      const bRel = (b.seatIndex - mySeatIndex + 6) % 6;
      return aRel - bRel;
    });

  // Find the current player's name for the action bar
  const currentPlayer = gameView.round
    ? gameView.players.find((p) => p.id === gameView.round!.currentPlayerId)
    : null;
  const currentPlayerName = currentPlayer?.id === mySocketId
    ? undefined
    : currentPlayer?.name;

  const stakeLabel = gameView.stakeMultiplier === 2
    ? 'DOUBLED'
    : gameView.stakeMultiplier === 4
      ? 'QUADRUPLED'
      : null;

  return (
    <div className="min-h-screen bg-green-900 relative overflow-hidden">
      {/* Game info bar */}
      <div className="absolute top-2 left-2 sm:left-1/2 sm:-translate-x-1/2 z-10 flex gap-2 sm:gap-3 items-center flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          gameView.myTeam === 'red10'
            ? 'bg-red-600 text-white'
            : 'bg-gray-800 text-white'
        }`}>
          {gameView.myTeam === 'red10' ? 'Red Team' : 'Black Team'}
        </span>
        {stakeLabel && (
          <span className="text-yellow-400 text-xs font-bold bg-yellow-900/60 px-2 py-0.5 rounded-full animate-pulse">
            x{gameView.stakeMultiplier} {stakeLabel}
          </span>
        )}
        {/* Turn timer */}
        {gameView.phase === 'playing' && gameView.round && (
          <TurnTimer
            turnStartTime={turnStartTime}
            isMyTurn={gameView.isMyTurn}
          />
        )}
      </div>

      {/* Table surface */}
      <div className="absolute inset-4 sm:inset-8 top-10 sm:top-12 bottom-32 sm:bottom-36 rounded-[50%] bg-green-800 border-4 border-green-700 shadow-inner" />

      {/* Center play area */}
      <div className="absolute top-[40%] sm:top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-[280px] sm:w-auto">
        <PlayArea round={gameView.round} players={gameView.players} />
      </div>

      {/* Other players */}
      {otherPlayers.map((player, index) => {
        const pos = POSITIONS[index];
        if (!pos) return null;
        const isCurrentTurn = gameView.round?.currentPlayerId === player.id;
        return (
          <div
            key={player.id}
            className="absolute z-10 hidden sm:block"
            style={pos as React.CSSProperties}
          >
            <OtherPlayer player={player} isCurrentTurn={isCurrentTurn} />
          </div>
        );
      })}
      {/* Mobile player positions */}
      {otherPlayers.map((player, index) => {
        const pos = MOBILE_POSITIONS[index];
        if (!pos) return null;
        const isCurrentTurn = gameView.round?.currentPlayerId === player.id;
        return (
          <div
            key={`mobile-${player.id}`}
            className="absolute z-10 sm:hidden"
            style={pos as React.CSSProperties}
          >
            <OtherPlayer player={player} isCurrentTurn={isCurrentTurn} compact />
          </div>
        );
      })}

      {/* My hand at the bottom */}
      <div className="absolute bottom-12 sm:bottom-12 left-0 right-0 z-20">
        {/* Player name label */}
        <div className="text-center mb-1">
          <span className="text-white text-xs sm:text-sm font-semibold">
            {myPlayer?.name ?? 'You'}
          </span>
          <span className="text-green-400 text-xs ml-1">(You)</span>
        </div>
        <PlayerHand
          cards={gameView.myHand}
          selectedCards={selectedCards}
          onToggleCard={onToggleCard}
        />
      </div>

      {/* Action bar at the very bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <ActionBar
          validActions={gameView.validActions}
          isMyTurn={gameView.isMyTurn}
          selectedCards={selectedCards}
          onPlay={onPlay}
          onPass={onPass}
          onDefuse={onDefuse}
          onCha={onCha}
          onGoCha={onGoCha}
          onDeclineCha={onDeclineCha}
          currentPlayerName={currentPlayerName}
          chaGoState={gameView.round?.chaGoState}
          round={gameView.round}
          errorMessage={errorMessage}
        />
      </div>

      {/* Game log */}
      <GameLog entries={gameLog} />

      {/* Toast error notification */}
      {errorMessage && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-red-900/95 border border-red-600 rounded-lg px-4 py-2 text-red-200 text-sm shadow-xl animate-fade-in max-w-[90vw] sm:max-w-md">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

export default GameTable;
