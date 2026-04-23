import { useState, useEffect, useCallback } from 'react';
import type { ClientGameView, GameResult, Team } from '@red10/shared';

interface ScoreBoardProps {
  gameView: ClientGameView;
  mySocketId: string;
  onPlayAgain: () => void;
  onRequestLog?: () => void;
  gameLogText?: string | null;
}

function ScoreBoard({ gameView, mySocketId, onPlayAgain, onRequestLog, gameLogText }: ScoreBoardProps) {
  const result = gameView.gameResult;
  const totalPlayers = gameView.players.length;
  const playAgainCount = gameView.playAgainCount ?? 0;
  const [logRequested, setLogRequested] = useState(false);

  const handleDownloadLog = useCallback(() => {
    if (gameLogText) {
      const blob = new Blob([gameLogText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `red10-game-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (onRequestLog && !logRequested) {
      setLogRequested(true);
      onRequestLog();
    }
  }, [gameLogText, onRequestLog, logRequested]);

  // Auto-download once log text arrives after request
  useEffect(() => {
    if (logRequested && gameLogText) {
      const blob = new Blob([gameLogText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `red10-game-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setLogRequested(false);
    }
  }, [gameLogText, logRequested]);

  // Group players by team
  const red10Team = gameView.players.filter((p) => p.team === 'red10');
  const black10Team = gameView.players.filter((p) => p.team === 'black10');

  const teamLabel = (team: Team) => (team === 'red10' ? 'Red 10 Team' : 'Black 10 Team');

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full p-4 sm:p-8">
        {/* Header */}
        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-2 text-white">Game Over</h1>

        {result ? (
          <>
            {/* Winner announcement */}
            <div className={`text-center text-base sm:text-xl font-semibold mb-3 sm:mb-6 ${
              result.scoringTeamWon ? 'text-green-400' : 'text-red-400'
            }`}>
              {result.scoringTeamWon
                ? `${teamLabel(result.scoringTeam)} Wins!`
                : 'Scoring team failed! No payouts.'}
            </div>

            {/* Stake multiplier */}
            <div className="text-center text-yellow-400 text-xs sm:text-sm mb-3 sm:mb-6">
              Stake Multiplier: x{gameView.stakeMultiplier}
              {gameView.stakeMultiplier > 1 && (
                <span className="text-gray-400 ml-2">
                  ({gameView.stakeMultiplier === 2 ? 'Doubled' : 'Quadrupled'})
                </span>
              )}
            </div>

            {/* Team rosters — stack on mobile, side-by-side on tablet+. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 mb-4 sm:mb-6">
              {[
                { team: 'red10' as Team, members: red10Team },
                { team: 'black10' as Team, members: black10Team },
              ].map(({ team, members }) => (
                <div key={team} className={`rounded-lg p-3 sm:p-4 ${
                  team === 'red10' ? 'bg-red-900/30 border border-red-700' : 'bg-gray-700/30 border border-gray-600'
                }`}>
                  <h3 className={`text-sm font-bold mb-3 uppercase tracking-wider ${
                    team === 'red10' ? 'text-red-400' : 'text-gray-300'
                  }`}>
                    {teamLabel(team)}
                    {team === result.scoringTeam && (
                      <span className="ml-2 text-xs text-yellow-400">(Scoring)</span>
                    )}
                  </h3>
                  <div className="space-y-2">
                    {members.map((player) => {
                      const isTrapped = result.trapped.includes(player.id);
                      const payout = result.payouts[player.id] ?? 0;
                      const isMe = player.id === mySocketId;

                      return (
                        <div
                          key={player.id}
                          className={`flex items-center justify-between text-sm rounded px-2 py-1 ${
                            isTrapped ? 'bg-red-800/40' : ''
                          } ${isMe ? 'ring-1 ring-blue-400' : ''}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs w-6">
                              {player.finishOrder ? `#${player.finishOrder}` : '--'}
                            </span>
                            <span className={`${isMe ? 'text-blue-300 font-semibold' : 'text-white'}`}>
                              {player.name}
                              {isMe && <span className="text-blue-400 text-xs ml-1">(You)</span>}
                            </span>
                            {isTrapped && (
                              <span className="text-xs text-red-400 font-medium">TRAPPED</span>
                            )}
                          </div>
                          <span className={`font-mono font-bold ${
                            payout > 0 ? 'text-green-400' : payout < 0 ? 'text-red-400' : 'text-gray-500'
                          }`}>
                            {payout > 0 ? `+$${payout}` : payout < 0 ? `-$${Math.abs(payout)}` : '$0'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Finish order */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                Finish Order
              </h3>
              <div className="flex flex-wrap gap-2">
                {gameView.finishOrder.map((playerId, index) => {
                  const player = gameView.players.find((p) => p.id === playerId);
                  return (
                    <span
                      key={playerId}
                      className="bg-gray-700 text-white text-xs px-2 py-1 rounded"
                    >
                      #{index + 1} {player?.name ?? playerId}
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-gray-400 mb-6">
            Calculating results...
          </div>
        )}

        {/* Actions */}
        <div className="text-center space-y-2 sm:space-y-3">
          <div className="flex justify-center gap-2 sm:gap-4">
            <button
              onClick={onPlayAgain}
              className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 sm:py-3 px-4 sm:px-8 rounded-lg text-base sm:text-lg transition-colors"
            >
              Play Again
            </button>
            <button
              onClick={handleDownloadLog}
              className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg text-base sm:text-lg transition-colors flex items-center gap-1.5 sm:gap-2"
              title="Download game log"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Log
            </button>
          </div>
          <div className="text-gray-400 text-xs sm:text-sm">
            {playAgainCount}/{totalPlayers} ready
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScoreBoard;
