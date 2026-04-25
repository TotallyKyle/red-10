import type { RoundInfo, ClientPlayerView, Play, Card as CardType, LastRoundWin } from '@red10/shared';
import { RANK_ORDER } from '@red10/shared';
import Card from './Card.js';
import { useViewportWidth } from '../hooks/useViewport.js';

/** Sort cards by rank for display (low to high) */
function sortByRank(cards: CardType[]): CardType[] {
  return [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
}

interface PlayAreaProps {
  round: RoundInfo | null;
  players: ClientPlayerView[];
  /**
   * Snapshot of the play that won the previous round. The engine wipes
   * round.lastPlay the instant the round ends (cha-go or all-pass), so this
   * is what keeps the winning cards on the table until the next play lands.
   */
  lastRoundWin?: LastRoundWin | null;
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

function getPlayerTeam(players: ClientPlayerView[], playerId: string) {
  return players.find((p) => p.id === playerId)?.team ?? null;
}

function isBombPlay(play: Play): boolean {
  return play.format === 'bomb';
}

function isRedTenBomb(play: Play): boolean {
  return !!play.specialBomb && (play.specialBomb === 'red10_2' || play.specialBomb === 'red10_3');
}

/**
 * Pick a card size for the center play area that fits the viewport with the
 * given number of cards. Favors the most readable size that won't overflow.
 */
function getPlaySize(cardCount: number, viewportWidth: number): 'sm' | 'md' | 'lg' {
  const isMobile = viewportWidth < 640;
  if (!isMobile) return 'lg';
  if (cardCount <= 3) return 'lg';  // 1–3 cards: big and readable
  if (cardCount <= 5) return 'md';  // 4–5 cards: medium (fits ~300px)
  return 'sm';                      // 6+ cards (paired straights): small but fits
}

function PlayArea({ round, players, lastRoundWin }: PlayAreaProps) {
  const viewportWidth = useViewportWidth();

  // Render the previous round's winning play whenever the engine has already
  // reset to a fresh round (no active lastPlay yet) but the snapshot is still
  // attached. The engine clears the snapshot on the next round's first play.
  const showRoundEnd = !!lastRoundWin && !round?.lastPlay;

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

  // History plays. On mobile we skip them — vertical space is precious and the
  // game log already shows the full history. Desktop keeps the last 1 play
  // faded above the current one for context.
  const isMobile = viewportWidth < 640;
  const recentPlays = isMobile ? round.plays.slice(-1) : round.plays.slice(-2);
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

      {/* Cha-go indicator — desktop only. Mobile shows the same status in
          the ActionBar, so duplicating here would cost ~40px of table area. */}
      {chaGo && (
        <div className="hidden sm:flex flex-col items-center gap-0.5">
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
              {sortByRank(play.cards).map((card) => (
                <Card key={card.id} card={card} size="sm" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Round-end banner — shown while the previous winning play is held on the table. */}
      {showRoundEnd && lastRoundWin && (
        <span className="text-yellow-300 text-[10px] sm:text-xs font-bold uppercase tracking-wider animate-pulse">
          {lastRoundWin.endedByChaGo ? 'Cha-Go Round Won!' : 'Round Won!'}
        </span>
      )}

      {/* Current play / main area */}
      <div
        className={`min-w-[160px] sm:min-w-[220px] min-h-[100px] sm:min-h-[130px] rounded-xl border-2 border-dashed flex items-center justify-center px-3 sm:px-5 py-3 transition-all duration-300 ${
          showRoundEnd
            ? 'border-yellow-400/80 bg-yellow-900/20 shadow-lg shadow-yellow-400/30'
            : currentPlay && isBombPlay(currentPlay)
              ? isRedTenBomb(currentPlay)
                ? 'border-red-500/80 bg-red-900/20 shadow-lg shadow-red-500/30'
                : 'border-orange-500/80 bg-orange-900/20 shadow-lg shadow-orange-500/30'
              : 'border-green-600/50'
        }`}
      >
        {showRoundEnd && lastRoundWin ? (
          <div className="flex items-center gap-0.5 sm:gap-1.5 animate-slide-in max-w-[calc(100vw_-_24px)]">
            {sortByRank(lastRoundWin.cards).map((card) => (
              <Card
                key={card.id}
                card={card}
                size={getPlaySize(lastRoundWin.cards.length, viewportWidth)}
              />
            ))}
          </div>
        ) : lastPlay ? (
          <div className="flex items-center gap-0.5 sm:gap-1.5 animate-slide-in max-w-[calc(100vw_-_24px)]">
            {sortByRank(lastPlay.cards).map((card) => (
              <Card
                key={card.id}
                card={card}
                size={getPlaySize(lastPlay.cards.length, viewportWidth)}
              />
            ))}
          </div>
        ) : (
          <span className="text-green-600/50 text-xs sm:text-sm">Waiting for leader...</span>
        )}
      </div>

      {/* Who played — shows the round-end winner during the hold, otherwise the current play owner. */}
      {showRoundEnd && lastRoundWin ? (
        <span className="text-yellow-200 text-[10px] sm:text-xs inline-flex items-center gap-1">
          {getPlayerName(players, lastRoundWin.winnerId)}
          {(() => {
            const team = getPlayerTeam(players, lastRoundWin.winnerId);
            if (!team) return null;
            return (
              <span
                className={`text-[9px] sm:text-[10px] font-bold px-1 sm:px-1.5 py-0.5 rounded-full ${
                  team === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'
                }`}
              >
                {team === 'red10' ? 'RED' : 'BLK'}
              </span>
            );
          })()}
          <span className="text-yellow-300/80 ml-0.5">won the round</span>
        </span>
      ) : lastPlay && (
        <span className="text-green-200 text-[10px] sm:text-xs inline-flex items-center gap-1">
          {getPlayerName(players, lastPlay.playerId)}
          {(() => {
            const team = getPlayerTeam(players, lastPlay.playerId);
            if (!team) return null;
            return (
              <span
                className={`text-[9px] sm:text-[10px] font-bold px-1 sm:px-1.5 py-0.5 rounded-full ${
                  team === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'
                }`}
              >
                {team === 'red10' ? 'RED' : 'BLK'}
              </span>
            );
          })()}
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
