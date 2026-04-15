import type { RoundInfo, ClientPlayerView, Play } from '@red10/shared';
import Card from './Card.js';

interface PlayAreaProps {
  round: RoundInfo | null;
  players: ClientPlayerView[];
}

const FORMAT_LABELS: Record<string, string> = {
  single: 'Singles',
  pair: 'Pairs',
  straight: 'Straight',
  paired_straight: 'Paired Straight',
  bomb: 'Bomb',
};

const CHA_GO_PHASE_LABELS: Record<string, string> = {
  waiting_cha: 'Waiting for Cha...',
  waiting_go: 'Waiting for Go...',
  waiting_final_cha: 'Waiting for Final Cha...',
};

function getPlayerName(players: ClientPlayerView[], playerId: string): string {
  return players.find((p) => p.id === playerId)?.name ?? 'Unknown';
}

function isBombPlay(play: Play): boolean {
  return play.format === 'bomb';
}

function isRedTenBomb(play: Play): boolean {
  return !!play.specialBomb && (play.specialBomb === 'red10_2' || play.specialBomb === 'red10_3');
}

function PlayArea({ round, players }: PlayAreaProps) {
  if (!round) {
    return (
      <div className="w-40 sm:w-48 h-24 sm:h-32 rounded-xl border-2 border-dashed border-green-600/50 flex items-center justify-center">
        <span className="text-green-600/50 text-xs sm:text-sm">No round in progress</span>
      </div>
    );
  }

  const lastPlay = round.lastPlay;
  const formatLabel = round.currentFormat ? FORMAT_LABELS[round.currentFormat] ?? round.currentFormat : null;
  const chaGo = round.chaGoState;

  // Get the last 3 plays for history display
  const recentPlays = round.plays.slice(-3);
  const olderPlays = recentPlays.slice(0, -1);
  const currentPlay = recentPlays[recentPlays.length - 1] ?? null;

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-2">
      {/* Format label */}
      {formatLabel && (
        <span className="text-green-300 text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
          {formatLabel}
        </span>
      )}

      {/* Cha-go indicator */}
      {chaGo && (
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-amber-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider animate-pulse">
            Cha-Go: {chaGo.triggerRank}
          </span>
          <span className="text-amber-300 text-[10px] sm:text-xs">
            {CHA_GO_PHASE_LABELS[chaGo.phase] ?? chaGo.phase}
          </span>
        </div>
      )}

      {/* Previous plays (faded) */}
      {olderPlays.length > 0 && (
        <div className="flex flex-col items-center gap-1 opacity-40 scale-90">
          {olderPlays.map((play, idx) => (
            <div key={`old-${idx}`} className="flex items-center gap-0.5">
              {play.cards.map((card) => (
                <Card key={card.id} card={card} size="sm" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Current play / main area */}
      <div
        className={`min-w-[100px] sm:min-w-[140px] min-h-[60px] sm:min-h-[80px] rounded-xl border-2 border-dashed flex items-center justify-center px-2 sm:px-4 py-2 transition-all duration-300 ${
          currentPlay && isBombPlay(currentPlay)
            ? isRedTenBomb(currentPlay)
              ? 'border-red-500/80 bg-red-900/20 shadow-lg shadow-red-500/30'
              : 'border-orange-500/80 bg-orange-900/20 shadow-lg shadow-orange-500/30'
            : 'border-green-600/50'
        }`}
      >
        {lastPlay ? (
          <div className="flex items-center gap-0.5 sm:gap-1 animate-slide-in">
            {lastPlay.cards.map((card) => (
              <Card key={card.id} card={card} size="sm" />
            ))}
          </div>
        ) : (
          <span className="text-green-600/50 text-xs sm:text-sm">Waiting for leader...</span>
        )}
      </div>

      {/* Who played */}
      {lastPlay && (
        <span className="text-green-200 text-[10px] sm:text-xs">
          {getPlayerName(players, lastPlay.playerId)}
          {isBombPlay(lastPlay) && (
            <span className={`ml-1 font-bold ${isRedTenBomb(lastPlay) ? 'text-red-400' : 'text-orange-400'}`}>
              BOMB!
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default PlayArea;
