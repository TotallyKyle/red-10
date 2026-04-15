import { useState, useCallback } from 'react';
import type { ClientGameView, Card as CardType, DoublingState, ClientPlayerView, Team } from '@red10/shared';

interface DoublingPhaseProps {
  gameView: ClientGameView;
  mySocketId: string;
  onDeclareDouble: (bombCards?: CardType[]) => void;
  onSkipDouble: () => void;
  onDeclareQuadruple: () => void;
  onSkipQuadruple: () => void;
}

const STAKE_LABELS: Record<number, string> = {
  1: '$1',
  2: '$2',
  4: '$4',
};

function DoublingPhase({
  gameView,
  mySocketId,
  onDeclareDouble,
  onSkipDouble,
  onDeclareQuadruple,
  onSkipQuadruple,
}: DoublingPhaseProps) {
  const [selectedBombCards, setSelectedBombCards] = useState<CardType[]>([]);
  const doubling = gameView.doubling;
  if (!doubling) return null;

  const myPlayer = gameView.players.find((p) => p.id === mySocketId);
  const isMyTurn = doubling.currentBidderId === mySocketId;
  const myTeam = gameView.myTeam;
  const isQuadruplePhase = doubling.isDoubled;

  const currentBidder = gameView.players.find((p) => p.id === doubling.currentBidderId);

  const handleToggleBombCard = useCallback((card: CardType) => {
    setSelectedBombCards((prev) => {
      const exists = prev.some((c) => c.id === card.id);
      if (exists) return prev.filter((c) => c.id !== card.id);
      return [...prev, card];
    });
  }, []);

  const handleDouble = useCallback(() => {
    if (myTeam === 'black10') {
      if (selectedBombCards.length === 0) return;
      onDeclareDouble(selectedBombCards);
    } else {
      onDeclareDouble();
    }
    setSelectedBombCards([]);
  }, [myTeam, selectedBombCards, onDeclareDouble]);

  const handleSkip = useCallback(() => {
    if (isQuadruplePhase) {
      onSkipQuadruple();
    } else {
      onSkipDouble();
    }
  }, [isQuadruplePhase, onSkipQuadruple, onSkipDouble]);

  return (
    <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center p-8">
      {/* Stakes display */}
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Doubling Phase</h2>
        <div className="text-yellow-400 text-xl font-bold">
          Stakes: {STAKE_LABELS[gameView.stakeMultiplier] ?? `$${gameView.stakeMultiplier}`} per trapped player
        </div>
      </div>

      {/* Team info */}
      <div className="mb-4">
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
          myTeam === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'
        }`}>
          You are on the {myTeam === 'red10' ? 'Red 10' : 'Black 10'} team
        </span>
      </div>

      {/* Player status */}
      <div className="grid grid-cols-3 gap-3 mb-6 max-w-lg w-full">
        {gameView.players.map((player) => (
          <PlayerDoublingStatus
            key={player.id}
            player={player}
            doubling={doubling}
            isCurrentBidder={doubling.currentBidderId === player.id}
            isMe={player.id === mySocketId}
          />
        ))}
      </div>

      {/* Revealed bombs */}
      {doubling.revealedBombs.length > 0 && (
        <div className="mb-4 bg-gray-900/50 rounded-lg p-3 max-w-lg w-full">
          <h3 className="text-amber-400 text-sm font-bold mb-2">Revealed Bombs:</h3>
          {doubling.revealedBombs.map((bomb, i) => {
            const bombPlayer = gameView.players.find((p) => p.id === bomb.playerId);
            return (
              <div key={i} className="text-white text-sm mb-1">
                <span className="font-semibold">{bombPlayer?.name ?? bomb.playerId}:</span>{' '}
                {bomb.cards.map((c) => `${c.rank}${getSuitSymbol(c.suit)}`).join(', ')}
              </div>
            );
          })}
        </div>
      )}

      {/* Revealed teams */}
      {doubling.teamsRevealed && (
        <div className="mb-4 bg-gray-900/50 rounded-lg p-3 max-w-lg w-full">
          <h3 className="text-amber-400 text-sm font-bold mb-2">Teams Revealed:</h3>
          <div className="flex flex-wrap gap-2">
            {gameView.players.map((player) => (
              <span
                key={player.id}
                className={`px-2 py-0.5 rounded text-xs font-bold ${
                  player.team === 'red10' ? 'bg-red-600 text-white' : 'bg-gray-700 text-white'
                }`}
              >
                {player.name}: {player.team === 'red10' ? 'Red' : 'Black'}
                {player.revealedRed10Count > 0 && ` (${player.revealedRed10Count} red 10s)`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action area */}
      <div className="mt-4">
        {isMyTurn && !isQuadruplePhase && (
          <div className="flex flex-col items-center gap-3">
            {/* Bomb card selection for black 10 team */}
            {myTeam === 'black10' && (
              <div className="mb-2">
                <p className="text-green-300 text-sm mb-2 text-center">
                  Select bomb cards to reveal (required for doubling):
                </p>
                <div className="flex gap-1 flex-wrap justify-center">
                  {gameView.myHand.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleToggleBombCard(card)}
                      className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                        selectedBombCards.some((c) => c.id === card.id)
                          ? 'bg-yellow-500 text-black'
                          : 'bg-gray-700 text-white hover:bg-gray-600'
                      }`}
                    >
                      {card.rank}{getSuitSymbol(card.suit)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleDouble}
                disabled={myTeam === 'black10' && selectedBombCards.length === 0}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
                  myTeam === 'black10' && selectedBombCards.length === 0
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                }`}
              >
                Double!
              </button>
              <button
                onClick={handleSkip}
                className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-gray-500 hover:bg-gray-400 text-white cursor-pointer"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {isMyTurn && isQuadruplePhase && (
          <div className="flex gap-3">
            <button
              onClick={onDeclareQuadruple}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-purple-600 hover:bg-purple-500 text-white cursor-pointer animate-pulse"
            >
              Quadruple!
            </button>
            <button
              onClick={handleSkip}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-colors bg-gray-500 hover:bg-gray-400 text-white cursor-pointer"
            >
              Skip
            </button>
          </div>
        )}

        {!isMyTurn && (
          <span className="text-green-300 text-sm">
            Waiting for {currentBidder?.name ?? 'other player'}...
          </span>
        )}
      </div>

      {/* My hand preview */}
      <div className="mt-8 max-w-2xl w-full">
        <h3 className="text-green-300 text-sm mb-2 text-center">Your Hand:</h3>
        <div className="flex gap-1 flex-wrap justify-center">
          {gameView.myHand.map((card) => (
            <span
              key={card.id}
              className={`px-2 py-1 rounded text-xs font-mono ${
                card.isRed ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-300'
              }`}
            >
              {card.rank}{getSuitSymbol(card.suit)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerDoublingStatus({
  player,
  doubling,
  isCurrentBidder,
  isMe,
}: {
  player: ClientPlayerView;
  doubling: DoublingState;
  isCurrentBidder: boolean;
  isMe: boolean;
}) {
  let status = '';
  let statusColor = 'text-gray-400';

  if (isCurrentBidder) {
    status = 'Bidding...';
    statusColor = 'text-yellow-400';
  } else if (doubling.revealedBombs.some((b) => b.playerId === player.id)) {
    status = 'Doubled (bomb)';
    statusColor = 'text-red-400';
  } else if (player.revealedRed10Count > 0 && doubling.isDoubled) {
    // Check if this player was the doubler (red10 team doubler)
    status = `${player.revealedRed10Count} red 10s`;
    statusColor = 'text-red-400';
  } else {
    status = 'Waiting';
  }

  return (
    <div className={`rounded-lg p-2 text-center ${
      isCurrentBidder ? 'bg-yellow-900/50 ring-2 ring-yellow-400' : 'bg-gray-900/50'
    }`}>
      <div className={`text-sm font-semibold ${isMe ? 'text-blue-300' : 'text-white'}`}>
        {player.name}{isMe ? ' (You)' : ''}
      </div>
      {player.team && (
        <div className={`text-xs ${player.team === 'red10' ? 'text-red-400' : 'text-gray-400'}`}>
          {player.team === 'red10' ? 'Red' : 'Black'}
        </div>
      )}
      <div className={`text-xs ${statusColor}`}>{status}</div>
    </div>
  );
}

function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = {
    hearts: '\u2665',
    diamonds: '\u2666',
    hearts2: '\u2665',
    clubs: '\u2663',
    spades: '\u2660',
    clubs2: '\u2663',
  };
  return symbols[suit] ?? suit;
}

export default DoublingPhase;
