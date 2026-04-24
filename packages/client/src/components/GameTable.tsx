import type { ClientGameView, Card as CardType } from '@red10/shared';
import type { GameLogEntry, RoundEndDisplay } from '../hooks/useSocket.js';
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
  onRequestLog?: () => void;
  gameLogText?: string | null;
  roundEndDisplay: RoundEndDisplay | null;
}

/**
 * Position definitions for 5 other players around the table.
 * Index 0 = directly across (top-center), then clockwise.
 */
/**
 * Seat positions for 5 other players around a table, clockwise from the
 * bottom-center player's perspective.
 *
 * Physical table layout (clockwise from "Me"):
 *
 *              Seat +3 (across, top center)
 *   Seat +2                       Seat +4
 *  (top left)                    (top right)
 *   Seat +1                       Seat +5
 * (bottom left)                (bottom right)
 *              Me (bottom center)
 *
 * Index 0 = next player clockwise (to my left)
 * Index 4 = player just before me (to my right)
 */
const POSITIONS = [
  // Seat +1: bottom left (next player clockwise)
  { bottom: '28%', left: '4%' },
  // Seat +2: top left
  { top: '18%', left: '4%' },
  // Seat +3: top center (across)
  { top: '4%', left: '50%', transform: 'translateX(-50%)' },
  // Seat +4: top right
  { top: '18%', right: '4%' },
  // Seat +5: bottom right (player just before me)
  { bottom: '28%', right: '4%' },
] as const;

/**
 * Mobile positions.
 *
 * The top-center player (seat +3, across) sits BELOW the status strip and has
 * enough headroom that the turn timer / team badge / stake indicator don't
 * visually overlap the player chip. Corners are pulled in tighter so they
 * clear both the top status strip and the bottom hand.
 */
const MOBILE_POSITIONS = [
  { bottom: '13.5rem', left: '2%' },
  { top: '11%', left: '2%' },
  { top: '2.5rem', left: '50%', transform: 'translateX(-50%)' },
  { top: '11%', right: '2%' },
  { bottom: '13.5rem', right: '2%' },
] as const;

function GameTable({
  gameView, mySocketId, selectedCards, onToggleCard, onPlay, onPass,
  onDefuse, onCha, onGoCha, onDeclineCha, gameLog, errorMessage, turnStartTime, onRequestLog, gameLogText,
  roundEndDisplay,
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
      {/* Game info bar — occupies the left half of the top row on mobile
          so the Game Log button (right half) and the seat-3 player (below)
          don't collide. */}
      <div className="absolute top-2 left-2 right-24 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-10 flex gap-1.5 sm:gap-3 items-center">
        <span className={`text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
          gameView.myTeam === 'red10'
            ? 'bg-red-600 text-white'
            : 'bg-gray-800 text-white'
        }`}>
          {gameView.myTeam === 'red10' ? 'Red' : 'Black'}
          <span className="hidden sm:inline"> Team</span>
        </span>
        {stakeLabel && (
          <span className="text-yellow-400 text-[10px] sm:text-xs font-bold bg-yellow-900/60 px-2 py-0.5 rounded-full animate-pulse shrink-0">
            x{gameView.stakeMultiplier}<span className="hidden sm:inline"> {stakeLabel}</span>
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

      {/* Table surface — `bottom-48` on mobile reserves space for the
          player-name + hand + action-bar stack underneath. */}
      <div className="absolute inset-4 sm:inset-8 top-10 sm:top-12 bottom-48 sm:bottom-36 rounded-[50%] bg-green-800 border-4 border-green-700 shadow-inner" />

      {/* Center play area — anchored to the middle of the TABLE (which now
          stops at bottom-48 on mobile), not the viewport, so it doesn't push
          into the hand area. */}
      <div className="absolute top-[calc(50%_-_2rem)] sm:top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <PlayArea round={gameView.round} players={gameView.players} roundEndDisplay={roundEndDisplay} />
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

      {/* Bottom UI stack — player name, hand, action bar all in one flex
          column so they never overlap. The ellipse table reserves space for
          this via `bottom-32 sm:bottom-36` above. When it's my turn the whole
          stack gets a glowing yellow ring so it's unmistakable. */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 flex flex-col transition-all ${
          gameView.isMyTurn
            ? 'ring-4 ring-yellow-400 ring-inset shadow-[0_-10px_32px_rgba(250,204,21,0.45)] animate-your-turn-glow'
            : ''
        }`}
      >
        {/* Player name label */}
        <div
          className={`text-center pb-1 sm:pb-2 pt-1 flex items-center justify-center gap-1.5 ${
            gameView.isMyTurn
              ? 'bg-gradient-to-t from-yellow-600/70 to-yellow-900/30'
              : 'bg-gradient-to-t from-green-900/60 to-transparent'
          }`}
        >
          <span className="text-white text-xs sm:text-sm font-semibold">
            {myPlayer?.name ?? 'You'}
          </span>
          <span className="text-green-400 text-xs">(You)</span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              gameView.myTeam === 'red10'
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-white'
            }`}
          >
            {gameView.myTeam === 'red10' ? 'RED' : 'BLK'}
          </span>
          {gameView.isMyTurn && (
            <span className="text-[11px] sm:text-xs font-extrabold px-2 py-0.5 rounded-full bg-yellow-400 text-black uppercase tracking-wide animate-pulse shadow-md">
              Your Turn
            </span>
          )}
        </div>
        <PlayerHand
          cards={gameView.myHand}
          selectedCards={selectedCards}
          onToggleCard={onToggleCard}
        />
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
      <GameLog entries={gameLog} onRequestLog={onRequestLog} logText={gameLogText} />

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
