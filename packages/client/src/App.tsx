import { useState, useCallback } from 'react';
import type { Card } from '@red10/shared';
import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.js';
import GameTable from './components/GameTable.js';

function App() {
  const socket = useSocket();
  const { gameView, mySocketId } = socket;
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

  // Game has started -- show game table
  if (gameView && mySocketId) {
    return (
      <GameTable
        gameView={gameView}
        mySocketId={mySocketId}
        selectedCards={selectedCards}
        onToggleCard={handleToggleCard}
      />
    );
  }

  // Lobby / waiting room
  return <Lobby socket={socket} />;
}

export default App;
