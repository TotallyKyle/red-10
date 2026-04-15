import { useEffect, useRef, useState } from 'react';
import type { GameLogEntry } from '../hooks/useSocket.js';

interface GameLogProps {
  entries: GameLogEntry[];
}

const TYPE_COLORS: Record<GameLogEntry['type'], string> = {
  play: 'text-white',
  pass: 'text-gray-400',
  round_won: 'text-yellow-400',
  round_new: 'text-green-400',
  cha_go: 'text-amber-400',
  bomb_defused: 'text-blue-400',
  team_revealed: 'text-purple-400',
  double: 'text-red-400',
  player_out: 'text-yellow-300',
  game_scored: 'text-emerald-400',
};

function GameLog({ entries }: GameLogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (scrollRef.current && isVisible) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, isVisible]);

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsVisible((v) => !v)}
        className="fixed top-2 right-2 z-50 bg-green-800/90 hover:bg-green-700 text-green-300 text-xs font-semibold px-3 py-1.5 rounded-lg border border-green-600 transition-colors sm:top-3 sm:right-3"
      >
        {isVisible ? 'Hide Log' : 'Game Log'}
        {!isVisible && entries.length > 0 && (
          <span className="ml-1 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
            {entries.length}
          </span>
        )}
      </button>

      {/* Log panel */}
      {isVisible && (
        <div className="fixed top-10 right-2 z-40 w-64 sm:w-72 max-h-[60vh] bg-gray-900/95 border border-green-700 rounded-lg shadow-xl flex flex-col sm:top-12 sm:right-3">
          <div className="px-3 py-2 border-b border-green-800 text-green-400 text-xs font-bold uppercase tracking-wider">
            Game Log
          </div>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-xs"
          >
            {entries.length === 0 ? (
              <span className="text-gray-500 italic">No events yet</span>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className={`${TYPE_COLORS[entry.type]} leading-snug`}>
                  {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default GameLog;
