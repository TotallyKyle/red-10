import type { ClientPlayerView } from '@red10/shared';

interface OtherPlayerProps {
  player: ClientPlayerView;
  isCurrentTurn?: boolean;
  compact?: boolean;
}

function OtherPlayer({ player, isCurrentTurn = false, compact = false }: OtherPlayerProps) {
  // Mini card back indicators
  const cardBacks = Math.min(player.handSize, 5);

  if (compact) {
    // Mobile compact view
    return (
      <div
        className={`relative flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg min-w-[60px] transition-all ${
          isCurrentTurn
            ? 'bg-yellow-500/60 ring-2 ring-yellow-300 animate-turn-ring'
            : 'bg-green-800/70'
        } ${!player.isConnected ? 'opacity-50' : ''}`}
      >
        {isCurrentTurn && (
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full bg-yellow-400 text-black shadow z-20">
            TURN
          </div>
        )}
        {/* OUT badge */}
        {player.isOut && (
          <div className="absolute -top-1 -right-1 bg-red-600 text-white text-[8px] font-bold px-1 rounded-full z-10">
            #{player.finishOrder}
          </div>
        )}
        <div className="text-white text-[10px] font-semibold truncate max-w-[60px]">
          {player.name}
        </div>
        {player.team && (
          <span className={`text-[8px] font-bold px-1 rounded-full ${
            player.team === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'
          }`}>
            {player.team === 'red10' ? 'R' : 'B'}
          </span>
        )}
        <div className="text-green-300 text-[10px] font-mono">{player.handSize}</div>
        {!player.isConnected && (
          <span className="text-red-400 text-[8px]">OFF</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl min-w-[90px] transition-all ${
        isCurrentTurn
          ? 'bg-yellow-600/50 ring-2 ring-yellow-300 shadow-lg shadow-yellow-400/40 animate-turn-ring'
          : 'bg-green-800/60'
      } ${!player.isConnected ? 'opacity-50' : ''} ${player.isOut ? 'opacity-70' : ''}`}
    >
      {/* TURN badge — sits above the card so it's obvious whose turn it is */}
      {isCurrentTurn && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-extrabold px-2 py-0.5 rounded-full z-20 shadow-md uppercase tracking-wide">
          Turn
        </div>
      )}

      {/* OUT badge overlay */}
      {player.isOut && (
        <div className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10 shadow-md">
          #{player.finishOrder} OUT
        </div>
      )}

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

      {/* Card count with mini card backs */}
      {!player.isOut && (
        <div className="flex items-center gap-1">
          <div className="flex -space-x-1.5">
            {Array.from({ length: cardBacks }).map((_, i) => (
              <div
                key={i}
                className="w-3 h-4 rounded-sm bg-gradient-to-br from-blue-700 to-blue-900 border border-blue-500/50"
                style={{ zIndex: i }}
              />
            ))}
          </div>
          <span className="text-green-300 text-xs font-mono ml-1">
            {player.handSize}
          </span>
        </div>
      )}

      {/* Connection status */}
      {!player.isConnected && (
        <span className="text-red-400 text-[10px]">Offline</span>
      )}
    </div>
  );
}

export default OtherPlayer;
