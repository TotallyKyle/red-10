import express from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ServerToClientEvents, ClientToServerEvents, Card } from '@red10/shared';
import {
  createRoom,
  joinRoom,
  toggleReady,
  startGame,
  handleDisconnect,
  handleReconnect,
  findDisconnectedPlayerForRejoin,
  findDisconnectedPlayerByName,
  getPlayerList,
  getRoomForSocket,
  addBotToRoom,
  validatePlayerName,
  setOnPlayerRemoved,
} from './lobby.js';
import type { Room } from './lobby.js';
import { GameEngine } from './game/GameEngine.js';
import { BotManager } from './bot/BotManager.js';
import { GameLogger } from './bot/GameLogger.js';
import { pushGameLog } from './bot/GameLogPusher.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Active game engines, keyed by roomId */
const games = new Map<string, GameEngine>();

/** Active turn timers, keyed by roomId. Stores cleanup function. */
const turnTimers = new Map<string, () => void>();

/** Bot manager singleton */
const botManager = new BotManager();

/** Game loggers, keyed by roomId */
const gameLoggers = new Map<string, GameLogger>();

/** Active bot action timers so we can clean them up */
const botTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

const TURN_TIMEOUT_MS = 30_000;
const BOT_ACTION_DELAY = 2000;
const BOT_CHA_DELAY = 1500;

/** Broadcast game state to all human players in the room (skips bots).
 *
 * Wrapped in try/catch so a single player whose socket id has drifted out of
 * sync with the engine's state (e.g., a botched reconnect) can't take down
 * the whole broadcast and leave everyone else frozen on a stale view. */
function broadcastState(roomId: string, room: Room, engine: GameEngine) {
  for (const p of room.players.values()) {
    if (botManager.isBot(p.socketId)) continue;
    try {
      const view = engine.getClientView(p.socketId);
      io.to(p.socketId).emit('game:state', view);
    } catch (err) {
      console.error(
        `[broadcastState] room=${roomId} player=${p.socketId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** Broadcast a game log entry to all human players. */
function broadcastLogEntry(roomId: string, room: Room, logger: GameLogger) {
  const entry = logger.getLastEntryForBroadcast();
  if (!entry) return;
  for (const p of room.players.values()) {
    if (!botManager.isBot(p.socketId)) {
      io.to(p.socketId).emit('game:log_entry', entry);
    }
  }
}

/** Emit team:revealed if the played cards include a red 10. */
function emitTeamRevealedIfNeeded(roomId: string, playerId: string, cards: Card[], engine: GameEngine): void {
  const hasRedTen = cards.some(c => c.rank === '10' && c.isRed);
  if (!hasRedTen) return;
  const player = engine.getState().players.find(p => p.id === playerId);
  if (!player) return;
  io.to(roomId).emit('team:revealed', {
    playerId,
    team: player.team!,
    red10Count: player.revealedRed10Count,
  });
}

/** Set up turn timer for the current player. Clears any previous timer for this room. */
function setupTurnTimer(roomId: string, room: Room) {
  // Clear existing timer
  const existingCleanup = turnTimers.get(roomId);
  if (existingCleanup) existingCleanup();
  turnTimers.delete(roomId);

  const engine = games.get(roomId);
  if (!engine) return;

  // Don't set turn timers for bots — they handle themselves
  const state = engine.getState();
  if (state.phase === 'playing' && state.round) {
    if (botManager.isBot(state.round.currentPlayerId)) return;
  }

  const cleanup = engine.setupTurnTimer(TURN_TIMEOUT_MS, (playerId) => {
    // Auto-pass happened
    io.to(roomId).emit('player:passed', { playerId });

    const logger = gameLoggers.get(roomId);
    if (logger) {
      logger.logAction(engine, playerId, 'pass');
      broadcastLogEntry(roomId, room, logger);
    }

    const st = engine.getState();
    if (st.round && st.round.plays.length === 0) {
      io.to(roomId).emit('round:won', { winnerId: st.round.leaderId });
      io.to(roomId).emit('round:new', { leaderId: st.round.leaderId });
      if (logger) {
        logger.logRoundEnd(engine, st.round.leaderId);
        logger.logRoundStart(engine, st.round.leaderId);
      }
    }

    broadcastState(roomId, room, engine);

    // Check if next player is a bot
    scheduleBotAction(roomId);

    // Set up next turn timer
    setupTurnTimer(roomId, room);
  });

  if (cleanup) {
    turnTimers.set(roomId, cleanup);
  }
}

/** Clear turn timer for a room */
function clearTurnTimer(roomId: string) {
  const cleanup = turnTimers.get(roomId);
  if (cleanup) cleanup();
  turnTimers.delete(roomId);
}

/** Clear all bot timers for a room */
function clearBotTimers(roomId: string) {
  const timers = botTimers.get(roomId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
  }
  botTimers.delete(roomId);
}

function addBotTimer(roomId: string, timer: ReturnType<typeof setTimeout>) {
  let timers = botTimers.get(roomId);
  if (!timers) {
    timers = [];
    botTimers.set(roomId, timers);
  }
  timers.push(timer);
}

/**
 * Execute a bot action on the game engine and broadcast results.
 * This mirrors the human socket handlers but runs server-side.
 */
function executeBotAction(roomId: string, botId: string, engine: GameEngine, room: Room): void {
  const action = botManager.processBotTurn(roomId, botId, engine);
  if (!action) return;

  const logger = gameLoggers.get(roomId);
  const state = engine.getState();

  // ---- Doubling phase actions ----
  if (state.phase === 'doubling') {
    switch (action.action) {
      case 'double': {
        const result = engine.declareDouble(botId, action.bombCards);
        if (!result.success) break;
        const st = engine.getState();
        const doubling = st.doubling;
        const revealedBomb = doubling?.revealedBombs.find((b) => b.playerId === botId);
        io.to(roomId).emit('double:declared', {
          playerId: botId,
          revealedCards: revealedBomb?.cards,
        });
        if (doubling?.teamsRevealed) {
          for (const p of st.players) {
            if (p.revealedRed10Count > 0) {
              io.to(roomId).emit('team:revealed', {
                playerId: p.id,
                team: p.team!,
                red10Count: p.revealedRed10Count,
              });
            }
          }
        }
        if (logger) {
          logger.logDoubling(engine, botId, 'double', revealedBomb?.cards);
          broadcastLogEntry(roomId, room, logger);
        }
        break;
      }
      case 'skip': {
        const result = engine.skipDouble(botId);
        if (!result.success) break;
        if (logger) {
          logger.logDoubling(engine, botId, 'skip');
          broadcastLogEntry(roomId, room, logger);
        }
        break;
      }
      case 'quadruple': {
        const result = engine.declareQuadruple(botId, action.bombCards);
        if (!result.success) break;
        if (logger) {
          logger.logDoubling(engine, botId, 'quadruple');
          broadcastLogEntry(roomId, room, logger);
        }
        break;
      }
      case 'skip_quadruple': {
        const result = engine.skipQuadruple(botId);
        if (!result.success) break;
        if (logger) {
          logger.logDoubling(engine, botId, 'skip_quadruple');
          broadcastLogEntry(roomId, room, logger);
        }
        break;
      }
    }

    const postState = engine.getState();
    if (postState.phase === 'playing' && postState.round) {
      io.to(roomId).emit('round:new', { leaderId: postState.round.leaderId });
      if (logger) logger.logRoundStart(engine, postState.round.leaderId);
      setupTurnTimer(roomId, room);
    }

    broadcastState(roomId, room, engine);
    scheduleBotAction(roomId);
    return;
  }

  // ---- Playing phase actions ----
  switch (action.action) {
    case 'play': {
      const result = engine.playCards(botId, action.cards);
      if (!result.success) break;

      const st = engine.getState();
      const format = st.round?.plays?.[st.round.plays.length - 1]?.format
        ?? st.round?.currentFormat ?? 'single';

      io.to(roomId).emit('play:made', { playerId: botId, cards: action.cards, format });

      if (logger) {
        logger.logAction(engine, botId, 'play', action.cards);
        broadcastLogEntry(roomId, room, logger);
      }

      // Check red 10s
      emitTeamRevealedIfNeeded(roomId, botId, action.cards, engine);

      // Player out
      const player = st.players.find(p => p.id === botId);
      if (player?.isOut && player.finishOrder !== null) {
        io.to(roomId).emit('player:out', { playerId: botId, finishOrder: player.finishOrder });
      }

      // Game over
      if (st.phase === 'game_over') {
        const gameResult = engine.getGameResult();
        if (gameResult) io.to(roomId).emit('game:scored', gameResult);
        if (logger) {
          logger.logGameEnd(engine);
          broadcastLogEntry(roomId, room, logger);
          void pushGameLog({ roomId, engine, logger, botManager });
        }
        clearTurnTimer(roomId);
        broadcastState(roomId, room, engine);
        return;
      }

      // Cha-go triggered
      if (st.round?.chaGoState) {
        const cg = st.round.chaGoState;
        for (const eligibleId of cg.eligiblePlayerIds) {
          if (!botManager.isBot(eligibleId)) {
            io.to(eligibleId).emit('cha_go:opportunity', {
              rank: cg.triggerRank,
              timeoutMs: 10000,
            });
          }
        }
      }

      // New round
      if (st.round && st.round.plays.length === 0) {
        io.to(roomId).emit('round:won', { winnerId: st.round.leaderId });
        io.to(roomId).emit('round:new', { leaderId: st.round.leaderId });
        if (logger) {
          logger.logRoundEnd(engine, st.round.leaderId);
          logger.logRoundStart(engine, st.round.leaderId);
        }
      }

      setupTurnTimer(roomId, room);
      break;
    }

    case 'pass': {
      const result = engine.pass(botId);
      if (!result.success) break;

      io.to(roomId).emit('player:passed', { playerId: botId });

      if (logger) {
        logger.logAction(engine, botId, 'pass');
        broadcastLogEntry(roomId, room, logger);
      }

      const st = engine.getState();
      if (st.round && st.round.plays.length === 0) {
        io.to(roomId).emit('round:won', { winnerId: st.round.leaderId });
        io.to(roomId).emit('round:new', { leaderId: st.round.leaderId });
        if (logger) {
          logger.logRoundEnd(engine, st.round.leaderId);
          logger.logRoundStart(engine, st.round.leaderId);
        }
      }

      setupTurnTimer(roomId, room);
      break;
    }

    case 'cha': {
      const result = engine.cha(botId, action.cards);
      if (!result.success) break;

      const st = engine.getState();
      const triggerRank = st.round?.chaGoState?.triggerRank
        ?? st.round?.plays?.[st.round.plays.length - 1]?.cards?.[0]?.rank;
      if (triggerRank) {
        io.to(roomId).emit('cha_go:started', { rank: triggerRank as any, chaPlayerId: botId });
      }

      emitTeamRevealedIfNeeded(roomId, botId, action.cards, engine);

      if (logger) {
        logger.logAction(engine, botId, 'cha', action.cards);
        broadcastLogEntry(roomId, room, logger);
      }
      break;
    }

    case 'go_cha': {
      const result = engine.goCha(botId, action.cards);
      if (!result.success) break;

      io.to(roomId).emit('cha_go:go_cha', { playerId: botId, cards: action.cards });

      emitTeamRevealedIfNeeded(roomId, botId, action.cards, engine);

      if (logger) {
        logger.logAction(engine, botId, 'go_cha', action.cards);
        broadcastLogEntry(roomId, room, logger);
      }
      break;
    }

    case 'decline_cha': {
      const result = engine.declineCha(botId);
      if (!result.success) break;

      if (logger) {
        logger.logAction(engine, botId, 'decline_cha');
        broadcastLogEntry(roomId, room, logger);
      }
      break;
    }

    case 'defuse': {
      const result = engine.defuse(botId, action.cards);
      if (!result.success) break;

      io.to(roomId).emit('bomb:defused', { defuserId: botId, cards: action.cards });

      emitTeamRevealedIfNeeded(roomId, botId, action.cards, engine);

      if (logger) {
        logger.logAction(engine, botId, 'defuse', action.cards);
        broadcastLogEntry(roomId, room, logger);
      }
      break;
    }
  }

  broadcastState(roomId, room, engine);
  scheduleBotAction(roomId);
}

/**
 * Schedule a bot action if the current player (or eligible cha-go bots) is a bot.
 */
function scheduleBotAction(roomId: string): void {
  const engine = games.get(roomId);
  const room = getRoomForSocket_byRoomId(roomId);
  if (!engine || !room) return;

  const state = engine.getState();
  if (state.phase === 'game_over') return;

  // ---- Doubling phase ----
  if (state.phase === 'doubling' && state.doubling) {
    const bidderId = state.doubling.currentBidderId;
    if (bidderId && botManager.isBot(bidderId)) {
      const timer = setTimeout(() => {
        executeBotAction(roomId, bidderId, engine, room);
      }, BOT_ACTION_DELAY);
      addBotTimer(roomId, timer);
    }
    return;
  }

  // ---- Playing phase ----
  if (state.phase !== 'playing' || !state.round) return;

  // Handle cha-go: all eligible bots should respond
  if (state.round.chaGoState) {
    const cg = state.round.chaGoState;
    if (cg.phase === 'waiting_cha' || cg.phase === 'waiting_final_cha') {
      // Find eligible bots that haven't declined
      const eligibleBots = cg.eligiblePlayerIds.filter(
        id => botManager.isBot(id) && !cg.declinedPlayerIds.includes(id)
      );
      let delay = BOT_CHA_DELAY;
      for (const botId of eligibleBots) {
        const timer = setTimeout(() => {
          // Re-check state before acting
          const currentState = engine.getState();
          if (currentState.phase !== 'playing') return;
          if (!currentState.round?.chaGoState) return;
          const currentCg = currentState.round.chaGoState;
          if (!currentCg.eligiblePlayerIds.includes(botId)) return;
          if (currentCg.declinedPlayerIds.includes(botId)) return;
          executeBotAction(roomId, botId, engine, room);
        }, delay);
        addBotTimer(roomId, timer);
        delay += BOT_CHA_DELAY;
      }
      return;
    }

    // waiting_go: current player is a bot
    if (cg.phase === 'waiting_go' && botManager.isBot(state.round.currentPlayerId)) {
      const timer = setTimeout(() => {
        executeBotAction(roomId, state.round!.currentPlayerId, engine, room);
      }, BOT_ACTION_DELAY);
      addBotTimer(roomId, timer);
      return;
    }
  }

  // Normal turn: current player is a bot
  const currentPlayerId = state.round.currentPlayerId;
  if (botManager.isBot(currentPlayerId)) {
    const timer = setTimeout(() => {
      executeBotAction(roomId, currentPlayerId, engine, room);
    }, BOT_ACTION_DELAY);
    addBotTimer(roomId, timer);
  }
}

/** Helper to get a room by roomId (not socketId). We need getRoom from lobby. */
function getRoomForSocket_byRoomId(roomId: string): Room | undefined {
  // We import getRoom from lobby
  return getRoom(roomId);
}

// Need to import getRoom separately
import { getRoom } from './lobby.js';

const app = express();
const httpServer = createServer(app);

/**
 * CORS origins for Socket.IO.
 *
 * - If `CORS_ORIGIN` env var is set, use it (comma-separated for multiple
 *   origins, or `*` to allow all — handy for quickly sharing with friends).
 * - Otherwise default to the local Vite dev server.
 *
 * Examples:
 *   CORS_ORIGIN=https://red10.vercel.app
 *   CORS_ORIGIN=https://red10.vercel.app,https://red10-git-main-you.vercel.app
 *   CORS_ORIGIN=*
 */
const corsEnv = process.env.CORS_ORIGIN?.trim();
const corsOrigin: string | string[] =
  !corsEnv || corsEnv === '*'
    ? (corsEnv === '*' ? '*' : 'http://localhost:5173')
    : corsEnv.split(',').map((s) => s.trim()).filter(Boolean);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

// When a disconnected player's reconnect window expires, broadcast so the
// remaining clients can drop the stale row instead of leaving it greyed out
// forever (which previously locked the lobby into a 7-row "6/6" state).
setOnPlayerRemoved((roomId, socketId) => {
  io.to(roomId).emit('room:player_removed', { playerId: socketId });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * In production, optionally serve the built client from the server. This lets
 * you host both halves on a single WebSocket-friendly platform (Fly.io,
 * Render, Railway, etc.) with one URL and no CORS to worry about.
 *
 * Enable by setting `SERVE_CLIENT=true` and ensuring the client build output
 * exists at `packages/client/dist` (i.e. run `npm run build` at the repo root).
 */
if (process.env.SERVE_CLIENT === 'true') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist is compiled from src — so in prod we're at packages/server/dist and
  // the client build lives at packages/client/dist (../../client/dist).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback: any non-API route returns index.html so client-side routing works.
  app.get(/^(?!\/(?:health|socket\.io)).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`Serving static client from ${clientDist}`);
}


/**
 * Shared post-reconnect plumbing for both rejoin paths (token-based via
 * `room:rejoin` and name-based via `room:join`). Reassigns the socket id on
 * the lobby + game engine, sends the rejoining client a fresh state snapshot,
 * and broadcasts the socket-id swap to everyone else so their player list
 * stops referencing the dead old socket.
 */
function completeRejoin(
  socket: TypedSocket,
  roomId: string,
  oldSocketId: string,
): { success: true; reconnectToken: string; playerName: string } | { success: false; error: string } {
  const reconnectResult = handleReconnect(oldSocketId, socket.id!, roomId);
  if (!reconnectResult) {
    return { success: false, error: 'Could not reconnect: invalid session or expired' };
  }
  const { room, player: rejoinedPlayer } = reconnectResult;

  void socket.join(roomId);

  // If the game has started, swap the socket id inside the engine and ship
  // the rejoining client an authoritative state snapshot.
  const engine = games.get(roomId);
  if (engine) {
    engine.updatePlayerId(oldSocketId, socket.id!);
    const view = engine.getClientView(socket.id!);
    socket.emit('game:state', view);
  }

  // Replay the room roster to the rejoining client so they can rebuild lobby
  // state from scratch (sessionStorage may have been wiped, this could be a
  // brand-new tab, etc.).
  const players = getPlayerList(room);
  for (const p of players) {
    socket.emit('room:player_joined', {
      player: { id: p.id, name: p.name },
      hostId: room.hostId,
    });
    if (p.isReady) {
      socket.emit('room:player_ready', { playerId: p.id });
    }
  }

  // Tell every OTHER socket in the room about the swap. Without this, their
  // player lists keep pointing at the dead old socket id (they marked it
  // disconnected on `room:player_left` and never get a paired update),
  // so their UI shows the player as "Disconnected" forever and ready-state
  // toggles fired by the new socket land on no one.
  socket.to(roomId).emit('room:player_removed', { playerId: oldSocketId });
  socket.to(roomId).emit('room:player_joined', {
    player: { id: socket.id!, name: rejoinedPlayer.name },
    hostId: room.hostId,
  });

  return {
    success: true,
    reconnectToken: rejoinedPlayer.reconnectToken,
    playerName: rejoinedPlayer.name,
  };
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // ---- Reconnection ----
  socket.on('room:rejoin', (data, cb) => {
    // Validate shape defensively — `data` comes straight off the socket.
    if (!data || typeof data !== 'object') {
      cb({ success: false, error: 'Invalid rejoin request' });
      return;
    }
    const { roomId, playerName, reconnectToken } = data as {
      roomId?: unknown;
      playerName?: unknown;
      reconnectToken?: unknown;
    };
    if (typeof roomId !== 'string' || typeof playerName !== 'string') {
      cb({ success: false, error: 'Invalid rejoin request' });
      return;
    }
    const normalizedRoomId = roomId.toUpperCase();

    // Any auth failure (no such room, no such disconnected slot, bad token)
    // collapses into the same generic error so an attacker can't distinguish
    // them by response content.
    const found = findDisconnectedPlayerForRejoin(normalizedRoomId, playerName, reconnectToken);
    if (!found) {
      cb({ success: false, error: 'Could not reconnect: invalid session or expired' });
      return;
    }

    const result = completeRejoin(socket, normalizedRoomId, found.oldSocketId);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    console.log(`${playerName} (${socket.id}) rejoined room ${normalizedRoomId} (was ${found.oldSocketId})`);
    cb({ success: true, reconnectToken: result.reconnectToken });
  });

  socket.on('room:create', (data, cb) => {
    const nameCheck = validatePlayerName(data?.playerName);
    if (!nameCheck.ok) {
      cb({ success: false, error: nameCheck.error });
      return;
    }
    const playerName = nameCheck.name;

    const room = createRoom(socket.id, playerName);
    void socket.join(room.id);
    // The creator is the only player so far — safe to pull their token.
    const creator = room.players.get(socket.id)!;
    console.log(`Room ${room.id} created by ${playerName} (${socket.id})`);
    cb({ success: true, roomId: room.id, reconnectToken: creator.reconnectToken });
  });

  socket.on('room:join', (data, cb) => {
    if (!data || typeof data !== 'object' || typeof data.roomId !== 'string') {
      cb({ success: false, error: 'Invalid join request' });
      return;
    }
    const nameCheck = validatePlayerName(data.playerName);
    if (!nameCheck.ok) {
      cb({ success: false, error: nameCheck.error });
      return;
    }
    const playerName = nameCheck.name;
    const normalizedRoomId = data.roomId.toUpperCase();

    // Name-based rejoin: if this name matches a player who is currently
    // disconnected, the user is reclaiming their seat (different browser,
    // expired sessionStorage, etc.) — route through the rejoin pipeline so
    // they get the live game state and we don't double-seat them. This is
    // intentionally less strict than `room:rejoin` (no token check); the
    // 4-char room code is the credential.
    const rejoinTarget = findDisconnectedPlayerByName(normalizedRoomId, playerName);
    if (rejoinTarget) {
      const result = completeRejoin(socket, normalizedRoomId, rejoinTarget.oldSocketId);
      if (!result.success) {
        cb({ success: false, error: result.error });
        return;
      }
      console.log(
        `${playerName} (${socket.id}) rejoined-by-name in room ${normalizedRoomId} (was ${rejoinTarget.oldSocketId})`,
      );
      cb({ success: true, reconnectToken: result.reconnectToken });
      return;
    }

    const result = joinRoom(normalizedRoomId, socket.id, playerName);

    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    const { room, player } = result;
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
    cb({ success: true, reconnectToken: player.reconnectToken });
  });

  socket.on('room:ready', () => {
    const result = toggleReady(socket.id);
    if (!result) return;

    const { room, player } = result;
    io.to(room.id).emit('room:player_ready', { playerId: player.socketId });
  });

  // ---- Fill with Bots ----
  socket.on('room:fill_bots', (cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ success: false, error: 'Not in a room' });
      return;
    }

    if (room.hostId !== socket.id) {
      cb({ success: false, error: 'Only the host can fill with bots' });
      return;
    }

    if (room.gameStarted) {
      cb({ success: false, error: 'Game already started' });
      return;
    }

    const currentCount = [...room.players.values()].filter(p => p.isConnected).length;
    if (currentCount >= 6) {
      cb({ success: false, error: 'Room is already full' });
      return;
    }

    const bots = botManager.fillWithBots(room.id, currentCount);
    if (bots.length === 0) {
      cb({ success: false, error: 'No bots needed' });
      return;
    }

    // Add each bot to the lobby room
    for (const bot of bots) {
      const lobbyPlayer = addBotToRoom(room.id, bot.id, bot.name);
      if (lobbyPlayer) {
        bot.seatIndex = lobbyPlayer.seatIndex;
        // Broadcast bot join to all human players
        io.to(room.id).emit('room:player_joined', {
          player: { id: bot.id, name: bot.name },
          hostId: room.hostId,
        });
        // Broadcast bot ready
        io.to(room.id).emit('room:player_ready', { playerId: bot.id });
      }
    }

    console.log(`Filled room ${room.id} with ${bots.length} bots`);
    cb({ success: true });
  });

  socket.on('room:start', () => {
    const result = startGame(socket.id);
    if (!result.success) {
      socket.emit('error', { message: result.error, code: 'START_FAILED' });
      return;
    }

    const { room } = result;
    // Only seat connected players in the engine. canStartGame already gates on
    // exactly PLAYER_COUNT connected & ready, but a still-disconnected entry
    // (within the reconnect window) would otherwise be passed in too — and
    // Deck.deal returns exactly PLAYER_COUNT hands, so any extra player makes
    // GameEngine.startGame throw on `hands[i]` out-of-bounds.
    const players = getPlayerList(room).filter((p) => p.isConnected);

    // Create the game engine
    const engine = new GameEngine(
      room.id,
      players.map((p) => ({ id: p.id, name: p.name, seatIndex: p.seatIndex })),
    );
    engine.startGame();
    games.set(room.id, engine);

    // Create a game logger
    const logger = new GameLogger();
    gameLoggers.set(room.id, logger);

    // Send personalized game state to each human player
    broadcastState(room.id, room, engine);

    // If we're already in playing phase (no doubling), emit round:new event
    const state = engine.getState();
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      logger.logRoundStart(engine, state.round.leaderId);
      setupTurnTimer(room.id, room);
    }

    console.log(`Game started in room ${room.id}`);

    // Schedule bot action if the first player is a bot
    scheduleBotAction(room.id);
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

    // Log
    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logDoubling(engine, socket.id, 'double', revealedBomb?.cards);
      broadcastLogEntry(room.id, room, logger);
    }

    // Broadcast updated game state to all human players
    broadcastState(room.id, room, engine);

    // Schedule bot action if next bidder is a bot
    scheduleBotAction(room.id);
  });

  socket.on('double:skip', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.skipDouble(socket.id);
    if (!result.success) return;

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logDoubling(engine, socket.id, 'skip');
      broadcastLogEntry(room.id, room, logger);
    }

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      if (logger) logger.logRoundStart(engine, state.round.leaderId);
      setupTurnTimer(room.id, room);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
  });

  socket.on('quadruple:declare', (data, cb) => {
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

    const result = engine.declareQuadruple(socket.id, data?.bombCards);
    if (!result.success) {
      cb({ success: false, error: result.error });
      return;
    }

    cb({ success: true });

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logDoubling(engine, socket.id, 'quadruple');
      broadcastLogEntry(room.id, room, logger);
    }

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      if (logger) logger.logRoundStart(engine, state.round.leaderId);
      setupTurnTimer(room.id, room);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
  });

  socket.on('quadruple:skip', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.skipQuadruple(socket.id);
    if (!result.success) return;

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logDoubling(engine, socket.id, 'skip_quadruple');
      broadcastLogEntry(room.id, room, logger);
    }

    const state = engine.getState();

    // If phase transitioned to playing, emit round:new
    if (state.phase === 'playing' && state.round) {
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      if (logger) logger.logRoundStart(engine, state.round.leaderId);
      setupTurnTimer(room.id, room);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
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

    const format = state.round?.plays?.[state.round.plays.length - 1]?.format
      ?? state.round?.currentFormat
      ?? 'single';

    io.to(room.id).emit('play:made', {
      playerId: socket.id,
      cards: data.cards,
      format,
    });

    // Log
    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'play', data.cards);
      broadcastLogEntry(room.id, room, logger);
    }

    // Check if any played cards are red 10s — emit team:revealed
    emitTeamRevealedIfNeeded(room.id, socket.id, data.cards, engine);

    // Check if the player went out
    const player = state.players.find((p) => p.id === socket.id);
    if (player?.isOut && player.finishOrder !== null) {
      io.to(room.id).emit('player:out', {
        playerId: socket.id,
        finishOrder: player.finishOrder,
      });
    }

    // Check if game ended — emit scored event
    if (state.phase === 'game_over') {
      const gameResult = engine.getGameResult();
      if (gameResult) {
        io.to(room.id).emit('game:scored', gameResult);
      }
      if (logger) {
        logger.logGameEnd(engine);
        broadcastLogEntry(room.id, room, logger);
        void pushGameLog({ roomId: room.id, engine, logger, botManager });
      }
      clearTurnTimer(room.id);
      broadcastState(room.id, room, engine);
      return;
    }

    // Check if cha-go was triggered
    if (state.round?.chaGoState) {
      const cg = state.round.chaGoState;
      // Emit opportunity to eligible human players
      for (const eligibleId of cg.eligiblePlayerIds) {
        if (!botManager.isBot(eligibleId)) {
          io.to(eligibleId).emit('cha_go:opportunity', {
            rank: cg.triggerRank,
            timeoutMs: 10000,
          });
        }
      }
    }

    // Check if a new round was started (round has no plays yet = just started)
    if (state.round && state.round.plays.length === 0) {
      io.to(room.id).emit('round:won', { winnerId: state.round.leaderId });
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      if (logger) {
        logger.logRoundEnd(engine, state.round.leaderId);
        logger.logRoundStart(engine, state.round.leaderId);
      }
    }

    // Reset turn timer after any play
    setupTurnTimer(room.id, room);

    broadcastState(room.id, room, engine);

    // Schedule bot action if next player is a bot
    scheduleBotAction(room.id);
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

    emitTeamRevealedIfNeeded(room.id, socket.id, data.cards, engine);

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'defuse', data.cards);
      broadcastLogEntry(room.id, room, logger);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
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

    emitTeamRevealedIfNeeded(room.id, socket.id, data.cards, engine);

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'cha', data.cards);
      broadcastLogEntry(room.id, room, logger);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
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

    emitTeamRevealedIfNeeded(room.id, socket.id, data.cards, engine);

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'go_cha', data.cards);
      broadcastLogEntry(room.id, room, logger);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
  });

  socket.on('cha:decline', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    const result = engine.declineCha(socket.id);
    if (!result.success) return;

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'decline_cha');
      broadcastLogEntry(room.id, room, logger);
    }

    broadcastState(room.id, room, engine);
    scheduleBotAction(room.id);
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

    const logger = gameLoggers.get(room.id);
    if (logger) {
      logger.logAction(engine, socket.id, 'pass');
      broadcastLogEntry(room.id, room, logger);
    }

    // Check if a new round started
    const state = engine.getState();
    if (state.round && state.round.plays.length === 0) {
      // Round was won, new round started
      io.to(room.id).emit('round:won', { winnerId: state.round.leaderId });
      io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
      if (logger) {
        logger.logRoundEnd(engine, state.round.leaderId);
        logger.logRoundStart(engine, state.round.leaderId);
      }
    }

    // Reset turn timer
    setupTurnTimer(room.id, room);

    broadcastState(room.id, room, engine);

    // Schedule bot action if next player is a bot
    scheduleBotAction(room.id);
  });

  socket.on('game:play_again', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const engine = games.get(room.id);
    if (!engine) return;

    // Auto play-again for all bots
    const bots = botManager.getBotsInRoom(room.id);
    for (const bot of bots) {
      engine.playAgain(bot.id);
    }

    const result = engine.playAgain(socket.id);

    if (result.allReady) {
      // Game has been reset — create a new logger
      const logger = new GameLogger();
      gameLoggers.set(room.id, logger);

      const state = engine.getState();

      // If we're in the playing phase already (no doubling), emit round:new
      if (state.phase === 'playing' && state.round) {
        io.to(room.id).emit('round:new', { leaderId: state.round.leaderId });
        logger.logRoundStart(engine, state.round.leaderId);
      }
    }

    broadcastState(room.id, room, engine);

    // Schedule bot action for new game
    if (result.allReady) {
      scheduleBotAction(room.id);
    }
  });

  // ---- Game Log ----
  socket.on('game:get_log', (cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      cb({ log: '' });
      return;
    }
    const logger = gameLoggers.get(room.id);
    if (!logger) {
      cb({ log: 'No game log available.' });
      return;
    }
    cb({ log: logger.getFormattedLog() });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const room = getRoomForSocket(socket.id);
    const oldHostId = room?.hostId;

    // Mark player as disconnected in game engine
    if (room) {
      const engine = games.get(room.id);
      if (engine) {
        engine.setPlayerDisconnected(socket.id!);
      }
    }

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

const PORT = Number(process.env.PORT ?? 3001);
// Bind to 0.0.0.0 in production so container platforms (Fly, Render, Docker)
// can route traffic into the process. Locally we still listen on all ifaces —
// it's harmless and matches what `vite` does.
const HOST = process.env.HOST ?? '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`Red 10 server running on http://${HOST}:${PORT}`);
  console.log(`CORS origin: ${JSON.stringify(corsOrigin)}`);
});
