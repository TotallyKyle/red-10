import { useState } from 'react';
import type { UseSocketReturn } from '../hooks/useSocket.js';
import { PLAYER_COUNT } from '@red10/shared';

interface LobbyProps {
  socket: UseSocketReturn;
}

function Lobby({ socket }: LobbyProps) {
  const { isConnected, roomState, errorMessage, createRoom, joinRoom, toggleReady, startGame, mySocketId } = socket;

  const [nameInput, setNameInput] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [mode, setMode] = useState<'initial' | 'create' | 'join'>('initial');

  const handleCreate = () => {
    if (!nameInput.trim()) return;
    createRoom(nameInput.trim());
  };

  const handleJoin = () => {
    if (!nameInput.trim() || !roomCodeInput.trim()) return;
    joinRoom(roomCodeInput.trim(), nameInput.trim());
  };

  // Waiting room view
  if (roomState) {
    const { roomId, players } = roomState;
    const connectedPlayers = players.filter((p) => p.isConnected);
    const allReady = connectedPlayers.length === PLAYER_COUNT && connectedPlayers.every((p) => p.isReady);
    const isHost = roomState.isHost;
    const myPlayer = players.find((p) => p.id === mySocketId);
    const amReady = myPlayer?.isReady ?? false;

    return (
      <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
        <div className="bg-green-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-green-700">
          {/* Room code */}
          <div className="text-center mb-6">
            <p className="text-green-400 text-sm uppercase tracking-wider mb-1">Room Code</p>
            <p className="text-5xl font-mono font-bold text-white tracking-widest">{roomId}</p>
          </div>

          {/* Player count */}
          <div className="text-center mb-4">
            <span className="text-green-300 text-lg">
              {connectedPlayers.length}/{PLAYER_COUNT} Players
            </span>
          </div>

          {/* Player list */}
          <div className="space-y-2 mb-6">
            {players.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between px-4 py-2 rounded-lg ${
                  p.isConnected ? 'bg-green-700/50' : 'bg-green-900/50 opacity-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-green-400 text-xs font-mono">#{p.seatIndex + 1}</span>
                  <span className="text-white font-medium">
                    {p.name}
                    {p.id === mySocketId && (
                      <span className="text-green-400 text-xs ml-1">(you)</span>
                    )}
                    {p.id === roomState.hostId && (
                      <span className="text-yellow-400 text-xs ml-1">(host)</span>
                    )}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    !p.isConnected
                      ? 'text-red-400'
                      : p.isReady
                        ? 'text-emerald-400'
                        : 'text-gray-400'
                  }`}
                >
                  {!p.isConnected ? 'Disconnected' : p.isReady ? 'Ready' : 'Not Ready'}
                </span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={toggleReady}
              className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
                amReady
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {amReady ? 'Unready' : 'Ready Up'}
            </button>

            {isHost && (
              <button
                onClick={startGame}
                disabled={!allReady}
                className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
                  allReady
                    ? 'bg-amber-500 hover:bg-amber-400 text-black'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                Start Game
              </button>
            )}
          </div>

          {/* Connection status */}
          <div className="mt-4 text-center">
            <span className={`text-xs ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              {isConnected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>

          {/* Error */}
          {errorMessage && (
            <div className="mt-3 bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm text-center">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Initial / Create / Join screen
  return (
    <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
      <div className="bg-green-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-green-700">
        <h1 className="text-4xl font-bold text-white text-center mb-2">Red 10</h1>
        <p className="text-green-400 text-center mb-8">Multiplayer Card Game</p>

        {/* Connection status */}
        <div className="text-center mb-6">
          <span className={`text-xs ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {isConnected ? 'Connected to server' : 'Connecting...'}
          </span>
        </div>

        {mode === 'initial' && (
          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              disabled={!isConnected}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold text-lg rounded-lg transition-colors"
            >
              Create Room
            </button>
            <button
              onClick={() => setMode('join')}
              disabled={!isConnected}
              className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold text-lg rounded-lg transition-colors"
            >
              Join Room
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-4">
            <div>
              <label className="block text-green-300 text-sm mb-1">Your Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Enter your name"
                maxLength={20}
                className="w-full px-4 py-3 bg-green-900 border border-green-600 rounded-lg text-white placeholder-green-600 focus:outline-none focus:border-emerald-400"
                autoFocus
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!nameInput.trim() || !isConnected}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold text-lg rounded-lg transition-colors"
            >
              Create Room
            </button>
            <button
              onClick={() => setMode('initial')}
              className="w-full py-2 text-green-400 hover:text-green-300 text-sm"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="space-y-4">
            <div>
              <label className="block text-green-300 text-sm mb-1">Your Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                className="w-full px-4 py-3 bg-green-900 border border-green-600 rounded-lg text-white placeholder-green-600 focus:outline-none focus:border-emerald-400"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-green-300 text-sm mb-1">Room Code</label>
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                placeholder="ABCD"
                maxLength={4}
                className="w-full px-4 py-3 bg-green-900 border border-green-600 rounded-lg text-white placeholder-green-600 focus:outline-none focus:border-emerald-400 font-mono text-center text-2xl tracking-widest uppercase"
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={!nameInput.trim() || !roomCodeInput.trim() || !isConnected}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold text-lg rounded-lg transition-colors"
            >
              Join Room
            </button>
            <button
              onClick={() => setMode('initial')}
              className="w-full py-2 text-green-400 hover:text-green-300 text-sm"
            >
              Back
            </button>
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <div className="mt-4 bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm text-center">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

export default Lobby;
