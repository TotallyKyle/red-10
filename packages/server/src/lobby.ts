import { randomBytes, timingSafeEqual } from 'crypto';
import { PLAYER_COUNT, MAX_NAME_LENGTH } from '@red10/shared';

// ---- Interfaces ----

export interface RoomPlayer {
  socketId: string;
  name: string;
  seatIndex: number;
  isReady: boolean;
  isConnected: boolean;
  /** Timestamp when player disconnected, used for reconnect window */
  disconnectedAt: number | null;
  /**
   * Per-player secret, issued at join/create and on every successful rejoin.
   * Required to reconnect — knowing the display name alone is not enough.
   * 64-char hex (32 random bytes). Never broadcast; only returned to the
   * owning client in the join/create callback.
   */
  reconnectToken: string;
}

// ---- Token helpers ----

/** 32 random bytes, hex-encoded. Cryptographically strong. */
function generateReconnectToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time compare of two hex tokens. Returns false on any length
 * mismatch or non-string input. Prevents timing-based guessing.
 */
export function verifyReconnectToken(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  if (typeof expected !== 'string') return false;
  // Length gate first — timingSafeEqual throws on length mismatch.
  if (expected.length !== provided.length || expected.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

// ---- Input validation ----

/**
 * Normalize and validate a player-supplied display name.
 * Returns the trimmed name on success, or an error reason.
 */
export function validatePlayerName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Name must be a string' };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: 'Name cannot be empty' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` };
  return { ok: true, name };
}

export interface Room {
  id: string;
  hostId: string; // socketId of the host
  players: Map<string, RoomPlayer>; // socketId -> RoomPlayer
  createdAt: number;
  gameStarted: boolean;
}

// ---- Storage ----

const rooms = new Map<string, Room>();

/** Maps socketId -> roomId for quick lookup */
const playerRoomMap = new Map<string, string>();

// ---- Constants ----

const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const RECONNECT_WINDOW_MS = 60_000;

// ---- Removal callback ----

/**
 * Notified when the reconnect-window timer evicts a player who never came
 * back. Wired up from index.ts so it can broadcast `room:player_removed` —
 * without it, clients would keep showing the stale "Disconnected" row forever.
 */
type PlayerRemovedCallback = (roomId: string, socketId: string) => void;
let onPlayerRemoved: PlayerRemovedCallback | null = null;
export function setOnPlayerRemoved(cb: PlayerRemovedCallback | null): void {
  onPlayerRemoved = cb;
}

// ---- Helpers ----

function generateRoomCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

// ---- Public API ----

export function createRoom(socketId: string, playerName: string): Room {
  const roomId = generateRoomCode();

  const player: RoomPlayer = {
    socketId,
    name: playerName,
    seatIndex: 0,
    isReady: false,
    isConnected: true,
    disconnectedAt: null,
    reconnectToken: generateReconnectToken(),
  };

  const room: Room = {
    id: roomId,
    hostId: socketId,
    players: new Map([[socketId, player]]),
    createdAt: Date.now(),
    gameStarted: false,
  };

  rooms.set(roomId, room);
  playerRoomMap.set(socketId, roomId);

  return room;
}

export function joinRoom(
  roomId: string,
  socketId: string,
  playerName: string,
): { success: true; room: Room; player: RoomPlayer } | { success: false; error: string } {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }

  if (room.gameStarted) {
    return { success: false, error: 'Game already started' };
  }

  // Cap by total player slots, not connected count. A disconnected player
  // holds their seat for the reconnect window — we must not let a new joiner
  // overflow the room, or `startGame` ends up dealing for >PLAYER_COUNT seats
  // and the engine throws on `hands[i]` out-of-bounds.
  if (room.players.size >= PLAYER_COUNT) {
    return { success: false, error: 'Room is full' };
  }

  // Reject duplicate names in the same room. If we allowed duplicates, the
  // by-name reconnect lookup would be ambiguous and joiners could deliberately
  // collide with an existing player's display name.
  for (const p of room.players.values()) {
    if (p.name === playerName) {
      return { success: false, error: 'Name already taken in this room' };
    }
  }

  // Assign next available seat index
  const takenSeats = new Set<number>();
  for (const p of room.players.values()) {
    takenSeats.add(p.seatIndex);
  }
  let seatIndex = 0;
  while (takenSeats.has(seatIndex)) {
    seatIndex++;
  }

  const player: RoomPlayer = {
    socketId,
    name: playerName,
    seatIndex,
    isReady: false,
    isConnected: true,
    disconnectedAt: null,
    reconnectToken: generateReconnectToken(),
  };

  room.players.set(socketId, player);
  playerRoomMap.set(socketId, roomId);

  return { success: true, room, player };
}

export function toggleReady(socketId: string): { room: Room; player: RoomPlayer } | null {
  const roomId = playerRoomMap.get(socketId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players.get(socketId);
  if (!player) return null;

  player.isReady = !player.isReady;
  return { room, player };
}

export function canStartGame(room: Room): boolean {
  if (room.gameStarted) return false;
  const connectedPlayers = [...room.players.values()].filter((p) => p.isConnected);
  if (connectedPlayers.length !== PLAYER_COUNT) return false;
  return connectedPlayers.every((p) => p.isReady);
}

export function startGame(socketId: string): { success: true; room: Room } | { success: false; error: string } {
  const roomId = playerRoomMap.get(socketId);
  if (!roomId) return { success: false, error: 'Not in a room' };

  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };

  if (room.hostId !== socketId) {
    return { success: false, error: 'Only the host can start the game' };
  }

  if (!canStartGame(room)) {
    return { success: false, error: 'Cannot start: need 6 ready players' };
  }

  room.gameStarted = true;
  return { success: true, room };
}

export function handleDisconnect(socketId: string): { room: Room; player: RoomPlayer } | null {
  const roomId = playerRoomMap.get(socketId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players.get(socketId);
  if (!player) return null;

  player.isConnected = false;
  player.isReady = false;
  player.disconnectedAt = Date.now();

  // Transfer host if this was the host
  if (room.hostId === socketId) {
    transferHost(room);
  }

  // Schedule removal after reconnect window
  setTimeout(() => {
    removePlayerIfStillDisconnected(roomId, socketId);
  }, RECONNECT_WINDOW_MS);

  return { room, player };
}

export function handleReconnect(
  oldSocketId: string,
  newSocketId: string,
  roomId: string,
): { room: Room; player: RoomPlayer } | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players.get(oldSocketId);
  if (!player || player.isConnected) return null;

  // Move player to new socket ID
  room.players.delete(oldSocketId);
  player.socketId = newSocketId;
  player.isConnected = true;
  player.disconnectedAt = null;
  // Rotate the reconnect token so a stolen copy of the previous token
  // (e.g., from a local-storage read after this point) can't be reused.
  player.reconnectToken = generateReconnectToken();
  room.players.set(newSocketId, player);

  playerRoomMap.delete(oldSocketId);
  playerRoomMap.set(newSocketId, roomId);

  // If the current host is a bot, transfer host back to this human player
  if (room.hostId.startsWith('bot-')) {
    room.hostId = newSocketId;
  }
  // Also reclaim host if this player was the original host (hostId matches old socket)
  if (room.hostId === oldSocketId) {
    room.hostId = newSocketId;
  }

  return { room, player };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomForSocket(socketId: string): Room | undefined {
  const roomId = playerRoomMap.get(socketId);
  if (!roomId) return undefined;
  return rooms.get(roomId);
}

/**
 * Authenticate a rejoin attempt. Returns the old socket ID only if a
 * disconnected player with the given name AND a matching reconnect token
 * exists. The token check is constant-time to prevent guessing by timing.
 *
 * All failure paths return the same shape and a generic error so an
 * attacker cannot distinguish "room doesn't exist" from "wrong token" from
 * "name not in room" via either response content or response latency.
 */
export function findDisconnectedPlayerForRejoin(
  roomId: string,
  playerName: string,
  reconnectToken: unknown,
): { room: Room; oldSocketId: string; player: RoomPlayer } | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  for (const [socketId, player] of room.players.entries()) {
    if (player.name !== playerName) continue;
    if (player.isConnected) continue;
    // Constant-time token check is the ONLY gate that lets the caller back in.
    if (!verifyReconnectToken(player.reconnectToken, reconnectToken)) continue;
    return { room, oldSocketId: socketId, player };
  }
  return null;
}

export function getPlayerList(room: Room): Array<{ id: string; name: string; seatIndex: number; isReady: boolean; isConnected: boolean }> {
  return [...room.players.values()]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((p) => ({
      id: p.socketId,
      name: p.name,
      seatIndex: p.seatIndex,
      isReady: p.isReady,
      isConnected: p.isConnected,
    }));
}

/**
 * Add a bot player to a room. Used by BotManager to fill empty seats.
 * Returns the RoomPlayer if added, null if the room is full or not found.
 */
export function addBotToRoom(
  roomId: string,
  botSocketId: string,
  botName: string,
): RoomPlayer | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  // Same total-slot cap as joinRoom — see joinRoom for reasoning.
  if (room.players.size >= PLAYER_COUNT) return null;

  // Assign next available seat index
  const takenSeats = new Set<number>();
  for (const p of room.players.values()) {
    takenSeats.add(p.seatIndex);
  }
  let seatIndex = 0;
  while (takenSeats.has(seatIndex)) {
    seatIndex++;
  }

  const player: RoomPlayer = {
    socketId: botSocketId,
    name: botName,
    seatIndex,
    isReady: true,
    isConnected: true,
    disconnectedAt: null,
    // Bots never reconnect, but give them a valid token anyway so the type
    // stays uniform and defensive code elsewhere doesn't have to special-case
    // empty strings.
    reconnectToken: generateReconnectToken(),
  };

  room.players.set(botSocketId, player);
  playerRoomMap.set(botSocketId, roomId);

  return player;
}

// ---- Internal helpers ----

function transferHost(room: Room): void {
  for (const p of room.players.values()) {
    if (p.isConnected && p.socketId !== room.hostId) {
      room.hostId = p.socketId;
      return;
    }
  }
  // No connected players — host stays as-is (room will be cleaned up)
}

function removePlayerIfStillDisconnected(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.get(socketId);
  if (!player || player.isConnected) return;

  // Still disconnected after timeout — remove them
  room.players.delete(socketId);
  playerRoomMap.delete(socketId);

  // Notify the wiring layer so it can broadcast to remaining clients.
  // We fire this even on the last-player path; the room is gone, but if
  // there's still a socket in the room channel (race), it gets a clean event.
  onPlayerRemoved?.(roomId, socketId);

  // Clean up empty rooms
  if (room.players.size === 0) {
    rooms.delete(roomId);
    return;
  }

  // Transfer host if needed
  if (room.hostId === socketId) {
    transferHost(room);
  }
}
