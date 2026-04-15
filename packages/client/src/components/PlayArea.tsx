import type { RoundInfo, ClientPlayerView } from '@red10/shared';
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

function PlayArea({ round, players }: PlayAreaProps) {
  if (!round) {
    return (
      <div className="w-48 h-32 rounded-xl border-2 border-dashed border-green-600/50 flex items-center justify-center">
        <span className="text-green-600/50 text-sm">No round in progress</span>
      </div>
    );
  }

  const lastPlay = round.lastPlay;
  const lastPlayerName = lastPlay
    ? players.find((p) => p.id === lastPlay.playerId)?.name ?? 'Unknown'
    : null;

  const formatLabel = round.currentFormat ? FORMAT_LABELS[round.currentFormat] ?? round.currentFormat : null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Format label */}
      {formatLabel && (
        <span className="text-green-300 text-xs uppercase tracking-wider font-semibold">
          {formatLabel}
        </span>
      )}

      {/* Cards */}
      <div className="min-w-[120px] min-h-[80px] rounded-xl border-2 border-dashed border-green-600/50 flex items-center justify-center px-4 py-2">
        {lastPlay ? (
          <div className="flex items-center gap-1">
            {lastPlay.cards.map((card) => (
              <Card key={card.id} card={card} size="sm" />
            ))}
          </div>
        ) : (
          <span className="text-green-600/50 text-sm">Waiting for leader...</span>
        )}
      </div>

      {/* Who played */}
      {lastPlayerName && (
        <span className="text-green-200 text-xs">
          Played by {lastPlayerName}
        </span>
      )}
    </div>
  );
}

export default PlayArea;
