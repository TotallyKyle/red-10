import { useState, useCallback } from 'react';
import type { Card } from '@red10/shared';
import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.js';
import GameTable from './components/GameTable.js';

function App() {
  const socket = useSocket();
  const { gameView, mySocketId, playCards, passAction, defuseAction } = socket;
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  const handleToggleCard = useCallback((card: Card) => {
    setSelectedCards((prev) => {
      const exists = prev.some((c) => c.id === card.id);
      if (exists) {
        return prev.filter((c) => c.id !== card.id);
      }
      return [...prev, card];
    });
  }, []);

  const handlePlay = useCallback(() => {
    if (selectedCards.length === 0) return;
    playCards(selectedCards);
    setSelectedCards([]);
  }, [selectedCards, playCards]);

  const handlePass = useCallback(() => {
    passAction();
    setSelectedCards([]);
  }, [passAction]);

  const handleDefuse = useCallback(() => {
    // Auto-select black 10s from hand for defuse
    if (!gameView) return;
    const black10s = gameView.myHand.filter((c) => c.rank === '10' && !c.isRed);
    // Determine how many are needed based on the last play
    const lastPlay = gameView.round?.lastPlay;
    if (!lastPlay?.specialBomb) return;
    const needed = lastPlay.specialBomb === 'red10_2' ? 2 : 3;
    const defuseCards = black10s.slice(0, needed);
    if (defuseCards.length >= needed) {
      defuseAction(defuseCards);
      setSelectedCards([]);
    }
  }, [gameView, defuseAction]);

  // Game has started -- show game table
  if (gameView && mySocketId) {
    return (
      <GameTable
        gameView={gameView}
        mySocketId={mySocketId}
        selectedCards={selectedCards}
        onToggleCard={handleToggleCard}
        onPlay={handlePlay}
        onPass={handlePass}
        onDefuse={handleDefuse}
      />
    );
  }

  // Lobby / waiting room
  return <Lobby socket={socket} />;
}

export default App;
