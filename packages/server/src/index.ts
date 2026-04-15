import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@red10/shared';
import {
  createRoom,
  joinRoom,
  toggleReady,
  startGame,
  handleDisconnect,
  getPlayerList,
  getRoomForSocket,
} from './lobby.js';
import { GameEngine } from './game/GameEngine.js';

/** Active game engines, keyed by roomId */
const games = new Map<string, GameEngine>();

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});


io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('room:create', (data, cb) => {
    const { playerName } = data;
    if (!playerName.trim()) {
      socket.emit('error', { message: 'Name cannot be empty', code: 'INVALID_NAME' });
      return;
    }

    const room = createRoom(socket.id, playerName);
    void socket.join(room.id);
    console.log(`Room ${room.id} created by ${playerName} (${socket.id})`);
    cb({ roomId: room.id });
  });

  socket.on('room:join', (data, cb) => {
    const { roomId, playerName } = data;
    const result = joinRoom(roomId.toUpperCase(), socket.id, playerName);

    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    const { room } = result;
    void socket.join(room.id);

    // Send the existing player list to the new joiner so they know who's already here
    const existingPlayers = getPlayerList(room);
    for (const p of existingPlayers) {
      if (p.id !== socket.id) {
        socket.emit('room:player_joined', { player: { id: p.id, name: p.name }, hostId: room.hostId });
        // If they're ready, also sync that state
        if (p.isReady) {
          socket.emit('room:player_ready', { playerId: p.id });
        }
      }
    }

    // Notify everyone in the room (including the new joiner, so they see themselves too)
    io.to(room.id).emit('room:player_joined', {
      player: { id: socket.id, name: playerName },
      hostId: room.hostId,
    });

    console.log(`${playerName} (${socket.id}) joined room ${room.id}`);
    cb({ success: true });
  });

  socket.on('room:ready', () => {
    const result = toggleReady(socket.id);
    if (!result) return;

    const { room, player } = result;
    io.to(room.id).emit('room:player_ready', { playerId: player.socketId });
  });

  socket.on('room:start', () => {
    const result = startGame(socket.id);
    if (!result.success) {
      socket.emit('error', { message: result.error, code: 'START_FAILED' });
      return;
    }

    const { room } = result;
    const players = getPlayerList(room);

    // Create the game engine
    const engine = new GameEngine(
      room.id,
      players.map((p) => ({ id: p.id, name: p.name, seatIndex: p.seatIndex })),
    );
    engine.startGame();
    games.set(room.id, engine);

    // Send personalized game state to each player
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }

    // If we're already in playing phase (no doubling), emit round:new event
    const state = engine.getState();
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    console.log(`Game started in room ${room.id}`);
  });

  socket.on('double:declare', (data, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.declareDouble(socket.id, data.bombCards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    const state = engine.getState();

    // Emit double:declared event
    const doubling = state.doubling;
    const revealedBomb = doubling?.revealedBombs.find((b) => b.playerId === socket.id);
    io.to(room.id).emit('double:declared', {
      playerId: socket.id,
      revealedCards: revealedBomb?.cards,
    });

    // Emit team:revealed for all red 10 holders
    if (doubling?.teamsRevealed) {
      for (const p of state.players) {
        if (p.revealedRed10Count > 0) {
          io.to(room.id).emit('team:revealed', {
            playerId: p.id,
            team: p.team!,
            red10Count: p.revealedRed10Count,
          });
        }
      }
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('double:skip', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.skipDouble(socket.id);
    if (!result.success) return;

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('quadruple:declare', (cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.declareQuadruple(socket.id);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('quadruple:skip', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.skipQuadruple(socket.id);
    if (!result.success) return;

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('play:cards', (data, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.playCards(socket.id, data.cards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    // Get the state to find what was played
    const state = engine.getState();

    // Find the play that was just made (last play in the round, or last play before round reset)
    // We need to emit play:made - find the cards that were played
    // Since the round may have been reset (new round started), we check the current round plays
    // or look at the previous state. We'll use the data.cards since they were validated.
    const format = state.round?.plays?.[state.round.plays.length - 1]?.format
      ?? state.round?.currentFormat
      ?? 'single';

    io.to(room.id).emit('play:made', {
      playerId: socket.id,
      cards: data.cards,
      format,
    });

    // Check if any played cards are red 10s — emit team:revealed
    const playedRed10s = data.cards.filter((c: { rank: string; isRed: boolean }) => c.rank === '10' && c.isRed);
    if (playedRed10s.length > 0) {
      const playerState = state.players.find((p) => p.id === socket.id);
      if (playerState) {
        io.to(room.id).emit('team:revealed', {
          playerId: socket.id,
          team: playerState.team!,
          red10Count: playerState.revealedRed10Count,
        });
      }
    }

    // Check if the player went out
    const player = state.players.find((p) => p.id === socket.id);
    if (player?.isOut && player.finishOrder !== null) {
      io.to(room.id).emit('player:out', {
        playerId: socket.id,
        finishOrder: player.finishOrder,
      });
    }

    // Check if cha-go was triggered
    if (state.round?.chaGoState) {
      const cg = state.round.chaGoState;
      // Emit opportunity to eligible players
      for (const eligibleId of cg.eligiblePlayerIds) {
        io.to(eligibleId).emit('cha_go:opportunity', {
          rank: cg.triggerRank,
          timeoutMs: 10000,
        });
      }
    }

    // Check if a new round was started (round has no plays yet = just started)
    if (state.round && state.round.plays.length === 0) {
      // A round was won by the last player who played, then a new round started
      io.to(room.id).emit('round:won', { winnerId: state.round.leaderId });
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('play:defuse', (data, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.defuse(socket.id, data.cards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    // Emit bomb:defused event
    io.to(room.id).emit('bomb:defused', {
      defuserId: socket.id,
      cards: data.cards,
    });

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('play:cha', (data, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.cha(socket.id, data.cards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    const state = engine.getState();
    const triggerRank = state.round?.chaGoState?.triggerRank
      ?? state.round?.plays?.[state.round.plays.length - 1]?.cards?.[0]?.rank;

    if (triggerRank) {
      io.to(room.id).emit('cha_go:started', { rank: triggerRank as any, chaPlayerId: socket.id });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('play:go_cha', (data, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    const engine = games.get(room.id);
    if (!engine) {
      cb({ success: false, error: 'No active game' });
      return;
    }

    const result = engine.goCha(socket.id, data.cards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    io.to(room.id).emit('cha_go:go_cha', { playerId: socket.id, cards: data.cards });

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('cha:decline', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.declineCha(socket.id);
    if (!result.success) return;

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('play:pass', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.pass(socket.id);
    if (!result.success) return;

    // Emit pass event
    io.to(room.id).emit('player:passed', { playerId: socket.id });

    // Check if a new round started
    const state = engine.getState();
    if (state.round && state.round.plays.length === 0) {
      // Round was won, new round started
      io.to(room.id).emit('round:won', { winnerId: state.round.leaderId });
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
    }

    // Broadcast updated game state to all players
    for (const p of room.players.values()) {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const room = getRoomForSocket(socket.id);
    const oldHostId = room?.hostId;
    const result = handleDisconnect(socket.id);
    if (result && room) {
      io.to(room.id).emit('room:player_left', { playerId: socket.id });
      // If host changed due to disconnect, notify everyone
      if (room.hostId !== oldHostId) {
        io.to(room.id).emit('room:host_changed', { hostId: room.hostId });
      }
    }
  });
});

const PORT = process.env.PORT ?? 3001;

httpServer.listen(PORT, () => {
  console.log(`Red 10 server running on http://localhost:${PORT}`);
});
