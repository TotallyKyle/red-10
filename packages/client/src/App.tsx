import { useState, useCallback } from 'react';
import type { Card } from '@red10/shared';
import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.js';
import GameTable from './components/GameTable.js';
import DoublingPhase from './components/DoublingPhase.js';
import ScoreBoard from './components/ScoreBoard.js';

function App() {
  const socket = useSocket();
  const {
    gameView, mySocketId, playCards, passAction, defuseAction, chaAction, goChaAction, declineChaAction,
    declareDouble, skipDoubleAction, declareQuadruple, skipQuadrupleAction, playAgain,
  } = socket;
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

  const handleCha = useCallback(() => {
    if (!gameView) return;
    const triggerRank = gameView.round?.chaGoState?.triggerRank;
    if (!triggerRank) return;
    // Auto-select a pair of the trigger rank from hand
    const matchingCards = gameView.myHand.filter((c) => c.rank === triggerRank);
    if (matchingCards.length >= 2) {
      chaAction(matchingCards.slice(0, 2));
      setSelectedCards([]);
    }
  }, [gameView, chaAction]);

  const handleGoCha = useCallback(() => {
    if (!gameView) return;
    const triggerRank = gameView.round?.chaGoState?.triggerRank;
    if (!triggerRank) return;
    // Auto-select 3 of the trigger rank from hand
    const matchingCards = gameView.myHand.filter((c) => c.rank === triggerRank);
    if (matchingCards.length >= 3) {
      goChaAction(matchingCards.slice(0, 3));
      setSelectedCards([]);
    }
  }, [gameView, goChaAction]);

  const handleDeclineCha = useCallback(() => {
    declineChaAction();
    setSelectedCards([]);
  }, [declineChaAction]);

  // Game over — show scoreboard
  if (gameView && mySocketId && gameView.phase === 'game_over') {
    return (
      <ScoreBoard
        gameView={gameView}
        mySocketId={mySocketId}
        onPlayAgain={playAgain}
      />
    );
  }

  // Doubling phase
  if (gameView && mySocketId && gameView.phase === 'doubling') {
    return (
      <DoublingPhase
        gameView={gameView}
        mySocketId={mySocketId}
        onDeclareDouble={declareDouble}
        onSkipDouble={skipDoubleAction}
        onDeclareQuadruple={declareQuadruple}
        onSkipQuadruple={skipQuadrupleAction}
      />
    );
  }

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
        onCha={handleCha}
        onGoCha={handleGoCha}
        onDeclineCha={handleDeclineCha}
      />
    );
  }

  // Lobby / waiting room
  return <Lobby socket={socket} />;
}

export default App;
