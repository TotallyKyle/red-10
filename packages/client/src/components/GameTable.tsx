import type { ClientGameView, Card as CardType } from '@red10/shared';
import PlayerHand from './PlayerHand.js';
import OtherPlayer from './OtherPlayer.js';
import PlayArea from './PlayArea.js';
import ActionBar from './ActionBar.js';

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
}

/**
 * Position definitions for 5 other players around the table.
 * Index 0 = directly across (top-center), then clockwise.
 */
const POSITIONS = [
  // top center
  { top: '4%', left: '50%', transform: 'translateX(-50%)' },
  // top right
  { top: '18%', right: '8%' },
  // bottom right
  { bottom: '28%', right: '8%' },
  // bottom left
  { bottom: '28%', left: '8%' },
  // top left
  { top: '18%', left: '8%' },
] as const;

function GameTable({ gameView, mySocketId, selectedCards, onToggleCard, onPlay, onPass, onDefuse, onCha, onGoCha, onDeclineCha }: GameTableProps) {
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

  return (
    <div className="min-h-screen bg-green-900 relative overflow-hidden">
      {/* Game info bar */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex gap-3 items-center">
        <span className="text-green-300 text-xs uppercase tracking-wider">
          Phase: <span className="text-emerald-400 font-mono">{gameView.phase}</span>
        </span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          gameView.myTeam === 'red10'
            ? 'bg-red-600 text-white'
            : 'bg-gray-800 text-white'
        }`}>
          {gameView.myTeam === 'red10' ? 'Red Team' : 'Black Team'}
        </span>
        {gameView.stakeMultiplier > 1 && (
          <span className="text-yellow-400 text-xs font-bold">
            x{gameView.stakeMultiplier}
          </span>
        )}
      </div>

      {/* Table surface */}
      <div className="absolute inset-8 top-12 bottom-36 rounded-[50%] bg-green-800 border-4 border-green-700 shadow-inner" />

      {/* Center play area */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
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
            className="absolute z-10"
            style={pos as React.CSSProperties}
          >
            <OtherPlayer player={player} isCurrentTurn={isCurrentTurn} />
          </div>
        );
      })}

      {/* My hand at the bottom */}
      <div className="absolute bottom-12 left-0 right-0 z-20">
        {/* Player name label */}
        <div className="text-center mb-1">
          <span className="text-white text-sm font-semibold">
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
        />
      </div>
    </div>
  );
}

export default GameTable;
