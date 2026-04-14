import type { ClientPlayerView } from '@red10/shared';

interface OtherPlayerProps {
  player: ClientPlayerView;
  isCurrentTurn?: boolean;
}

function OtherPlayer({ player, isCurrentTurn = false }: OtherPlayerProps) {
  return (
    <div
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl min-w-[90px] transition-colors ${
        isCurrentTurn
          ? 'bg-yellow-700/40 ring-2 ring-yellow-400'
          : 'bg-green-800/60'
      } ${!player.isConnected ? 'opacity-50' : ''}`}
    >
      {/* Name */}
      <div className="text-white text-sm font-semibold truncate max-w-[100px]">
        {player.name}
      </div>

      {/* Team badge */}
      {player.team && (
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            player.team === 'red10'
              ? 'bg-red-600 text-white'
              : 'bg-gray-800 text-white'
          }`}
        >
          {player.team === 'red10' ? 'RED' : 'BLK'}
        </span>
      )}

      {/* Card count */}
      <div className="flex items-center gap-1">
        <span className="text-green-300 text-xs font-mono">
          {player.handSize} cards
        </span>
      </div>

      {/* Out status */}
      {player.isOut && (
        <span className="text-yellow-300 text-[10px] font-bold">
          #{player.finishOrder} out
        </span>
      )}

      {/* Connection status */}
      {!player.isConnected && (
        <span className="text-red-400 text-[10px]">Offline</span>
      )}
    </div>
  );
}

export default OtherPlayer;
