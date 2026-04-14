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

    console.log(`Game started in room ${room.id}`);
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
