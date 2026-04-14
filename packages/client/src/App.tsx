import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.js';

function App() {
  const socket = useSocket();
  const { gameView } = socket;

  // Game has started — show placeholder
  if (gameView) {
    return (
      <div className="min-h-screen bg-green-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-4">Game Started!</h1>
          <p className="text-green-300 text-lg">
            Phase: <span className="font-mono text-emerald-400">{gameView.phase}</span>
          </p>
          <p className="text-green-400 mt-2 text-sm">
            {gameView.players.length} players in game
          </p>
        </div>
      </div>
    );
  }

  // Lobby / waiting room
  return <Lobby socket={socket} />;
}

export default App;
