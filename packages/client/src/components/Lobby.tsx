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

  // ── Waiting Room ──────────────────────────────────────────────
  if (roomState) {
    const { roomId, players } = roomState;
    const connectedPlayers = players.filter((p) => p.isConnected);
    const allReady = connectedPlayers.length === PLAYER_COUNT && connectedPlayers.every((p) => p.isReady);
    const isHost = roomState.isHost;
    const myPlayer = players.find((p) => p.id === mySocketId);
    const amReady = myPlayer?.isReady ?? false;

    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 via-green-900 to-emerald-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Room Code Card */}
          <div className="bg-green-800/60 backdrop-blur-sm rounded-3xl shadow-2xl shadow-black/40 border border-green-600/30 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-700/50 to-emerald-700/50 px-8 py-6 text-center border-b border-green-600/30">
              <p className="text-emerald-300/70 text-xs font-semibold uppercase tracking-[0.3em] mb-2">Room Code</p>
              <p className="text-5xl font-mono font-black text-white tracking-[0.2em] drop-shadow-lg">{roomId}</p>
              <p className="text-emerald-400/60 text-sm mt-2">
                Share this code with your friends
              </p>
            </div>

            {/* Player List */}
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-emerald-300/80 text-sm font-medium">Players</span>
                <span className="text-emerald-400 font-mono text-sm font-bold">
                  {connectedPlayers.length}<span className="text-emerald-600">/{PLAYER_COUNT}</span>
                </span>
              </div>

              <div className="space-y-2">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                      p.isConnected
                        ? 'bg-green-700/30 border border-green-600/20'
                        : 'bg-green-900/30 border border-green-800/20 opacity-40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Seat badge */}
                      <div className="w-7 h-7 rounded-full bg-green-600/30 border border-green-500/30 flex items-center justify-center">
                        <span className="text-emerald-300 text-xs font-bold">{p.seatIndex + 1}</span>
                      </div>
                      <div>
                        <span className="text-white font-medium text-sm">
                          {p.name}
                        </span>
                        {p.id === mySocketId && (
                          <span className="text-emerald-400 text-[10px] font-semibold ml-1.5 uppercase">you</span>
                        )}
                        {p.id === roomState.hostId && (
                          <span className="text-amber-400 text-[10px] font-semibold ml-1.5 uppercase">host</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!p.isConnected ? (
                        <span className="text-red-400/80 text-xs font-medium">Disconnected</span>
                      ) : p.isReady ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
                          <span className="text-emerald-400 text-xs font-semibold">Ready</span>
                        </div>
                      ) : (
                        <span className="text-green-500/60 text-xs">Waiting</span>
                      )}
                    </div>
                  </div>
                ))}

                {/* Empty slots */}
                {Array.from({ length: PLAYER_COUNT - players.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex items-center justify-center px-4 py-3 rounded-xl border border-dashed border-green-700/30 bg-green-900/10"
                  >
                    <span className="text-green-600/40 text-xs">Waiting for player...</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 space-y-3">
              <button
                onClick={toggleReady}
                className={`w-full py-3.5 rounded-xl font-bold text-base transition-all duration-200 ${
                  amReady
                    ? 'bg-amber-500/20 border-2 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-emerald-500 border-2 border-emerald-400/30 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/20'
                }`}
              >
                {amReady ? 'Cancel Ready' : 'Ready Up'}
              </button>

              {isHost && (
                <button
                  onClick={startGame}
                  disabled={!allReady}
                  className={`w-full py-3.5 rounded-xl font-bold text-base transition-all duration-200 ${
                    allReady
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:from-amber-400 hover:to-yellow-400 shadow-lg shadow-amber-500/30'
                      : 'bg-green-800/40 border border-green-700/30 text-green-600/40 cursor-not-allowed'
                  }`}
                >
                  {allReady ? 'Start Game' : `Need ${PLAYER_COUNT - connectedPlayers.filter(p => p.isReady).length} more ready`}
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-4 flex items-center justify-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-red-400'}`} />
              <span className={`text-[11px] ${isConnected ? 'text-emerald-400/60' : 'text-red-400/80'}`}>
                {isConnected ? 'Connected' : 'Reconnecting...'}
              </span>
            </div>
          </div>

          {/* Error toast */}
          {errorMessage && (
            <div className="mt-4 bg-red-500/10 backdrop-blur-sm border border-red-500/30 rounded-xl px-5 py-3 text-red-300 text-sm text-center">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Landing / Create / Join ───────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 via-green-900 to-emerald-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo area */}
        <div className="text-center mb-10">
          {/* Card decorations */}
          <div className="flex justify-center items-end gap-1 mb-6">
            <div className="w-8 h-12 rounded-md bg-white/90 shadow-lg -rotate-12 flex items-center justify-center border border-gray-200">
              <span className="text-red-600 text-lg font-bold">10</span>
            </div>
            <div className="w-10 h-14 rounded-md bg-white shadow-xl flex items-center justify-center border border-gray-200 -translate-y-1">
              <span className="text-red-600 text-xl font-black">10</span>
            </div>
            <div className="w-8 h-12 rounded-md bg-white/90 shadow-lg rotate-12 flex items-center justify-center border border-gray-200">
              <span className="text-red-600 text-lg font-bold">10</span>
            </div>
          </div>

          <h1 className="text-5xl font-black text-white tracking-tight drop-shadow-lg">
            Red <span className="text-red-500">10</span>
          </h1>
          <p className="text-emerald-400/60 text-sm mt-2 font-medium tracking-wide">
            Multiplayer Card Game
          </p>
        </div>

        {/* Main card */}
        <div className="bg-green-800/60 backdrop-blur-sm rounded-3xl shadow-2xl shadow-black/40 border border-green-600/30 px-7 py-8">
          {/* Connection indicator */}
          <div className="flex items-center justify-center gap-2 mb-7">
            <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isConnected ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-red-400 animate-pulse'}`} />
            <span className={`text-xs font-medium ${isConnected ? 'text-emerald-400/70' : 'text-red-400/80'}`}>
              {isConnected ? 'Connected to server' : 'Connecting...'}
            </span>
          </div>

          {mode === 'initial' && (
            <div className="space-y-3">
              <button
                onClick={() => setMode('create')}
                disabled={!isConnected}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-green-800/40 disabled:text-green-600/40 disabled:border-green-700/30 text-white font-bold text-lg rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-400/30 border border-emerald-400/20"
              >
                Create Room
              </button>
              <button
                onClick={() => setMode('join')}
                disabled={!isConnected}
                className="w-full py-4 bg-green-700/40 hover:bg-green-600/40 disabled:bg-green-800/20 disabled:text-green-600/40 text-white font-bold text-lg rounded-xl transition-all duration-200 border border-green-600/30 hover:border-green-500/40"
              >
                Join Room
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div className="space-y-5">
              <div>
                <label className="block text-emerald-300/70 text-xs font-semibold uppercase tracking-wider mb-2">Your Name</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Enter your name"
                  maxLength={20}
                  className="w-full px-4 py-3.5 bg-green-900/60 border border-green-600/30 rounded-xl text-white placeholder-green-600/50 focus:outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/20 transition-all text-base"
                  autoFocus
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!nameInput.trim() || !isConnected}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-green-800/40 disabled:text-green-600/40 text-white font-bold text-base rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/20 border border-emerald-400/20"
              >
                Create Room
              </button>
              <button
                onClick={() => setMode('initial')}
                className="w-full py-2 text-emerald-400/50 hover:text-emerald-300/70 text-sm transition-colors"
              >
                &larr; Back
              </button>
            </div>
          )}

          {mode === 'join' && (
            <div className="space-y-5">
              <div>
                <label className="block text-emerald-300/70 text-xs font-semibold uppercase tracking-wider mb-2">Your Name</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={20}
                  className="w-full px-4 py-3.5 bg-green-900/60 border border-green-600/30 rounded-xl text-white placeholder-green-600/50 focus:outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/20 transition-all text-base"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-emerald-300/70 text-xs font-semibold uppercase tracking-wider mb-2">Room Code</label>
                <input
                  type="text"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  placeholder="ABCD"
                  maxLength={4}
                  className="w-full px-4 py-4 bg-green-900/60 border border-green-600/30 rounded-xl text-white placeholder-green-600/40 focus:outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/20 transition-all font-mono text-center text-3xl tracking-[0.3em] uppercase"
                />
              </div>
              <button
                onClick={handleJoin}
                disabled={!nameInput.trim() || !roomCodeInput.trim() || !isConnected}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-green-800/40 disabled:text-green-600/40 text-white font-bold text-base rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/20 border border-emerald-400/20"
              >
                Join Room
              </button>
              <button
                onClick={() => setMode('initial')}
                className="w-full py-2 text-emerald-400/50 hover:text-emerald-300/70 text-sm transition-colors"
              >
                &larr; Back
              </button>
            </div>
          )}
        </div>

        {/* Error toast */}
        {errorMessage && (
          <div className="mt-4 bg-red-500/10 backdrop-blur-sm border border-red-500/30 rounded-xl px-5 py-3 text-red-300 text-sm text-center">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

export default Lobby;
