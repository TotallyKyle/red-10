import { PLAYER_COUNT } from '@red10/shared';

// ---- Interfaces ----

export interface RoomPlayer {
  socketId: string;
  name: string;
  seatIndex: number;
  isReady: boolean;
  isConnected: boolean;
  /** Timestamp when player disconnected, used for reconnect window */
  disconnectedAt: number | null;
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
): { success: true; room: Room } | { success: false; error: string } {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }

  if (room.gameStarted) {
    return { success: false, error: 'Game already started' };
  }

  if (!playerName.trim()) {
    return { success: false, error: 'Name cannot be empty' };
  }

  const connectedCount = getConnectedPlayerCount(room);
  if (connectedCount >= PLAYER_COUNT) {
    return { success: false, error: 'Room is full' };
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
  };

  room.players.set(socketId, player);
  playerRoomMap.set(socketId, roomId);

  return { success: true, room };
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
  room.players.set(newSocketId, player);

  playerRoomMap.delete(oldSocketId);
  playerRoomMap.set(newSocketId, roomId);

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
 * Find a disconnected player in a room by name.
 * Returns the old socket ID if found, null otherwise.
 */
export function findDisconnectedPlayer(roomId: string, playerName: string): { room: Room; oldSocketId: string } | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  for (const [socketId, player] of room.players.entries()) {
    if (player.name === playerName && !player.isConnected) {
      return { room, oldSocketId: socketId };
    }
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

  const connectedCount = getConnectedPlayerCount(room);
  if (connectedCount >= PLAYER_COUNT) return null;

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
  };

  room.players.set(botSocketId, player);
  playerRoomMap.set(botSocketId, roomId);

  return player;
}

// ---- Internal helpers ----

function getConnectedPlayerCount(room: Room): number {
  let count = 0;
  for (const p of room.players.values()) {
    if (p.isConnected) count++;
  }
  return count;
}

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
