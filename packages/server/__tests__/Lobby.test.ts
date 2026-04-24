/**
 * Lobby auth + reconnect tests.
 *
 * Two reconnect paths are intentionally permitted, with different bars:
 *
 * 1. `findDisconnectedPlayerForRejoin` (used by the `room:rejoin` event) —
 *    requires a per-player reconnect token. This is the strict path used on
 *    page reload when sessionStorage survived; tests below assert it cannot
 *    be bypassed by guessing or reusing rotated tokens.
 *
 * 2. `findDisconnectedPlayerByName` (used by the `room:join` event) —
 *    matches on room code + display name only, no token. This is the
 *    intentional UX fallback so a player who lost their session (different
 *    browser, fresh tab) can reclaim their seat by re-typing their name.
 *    The threat model is a private friends-game where the 4-char room code
 *    is the credential.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRoom,
  joinRoom,
  handleDisconnect,
  handleReconnect,
  findDisconnectedPlayerForRejoin,
  validatePlayerName,
  verifyReconnectToken,
  getRoom,
  getRoomForSocket,
  addBotToRoom,
  setOnPlayerRemoved,
  findDisconnectedPlayerByName,
} from '../src/lobby.js';
import { MAX_NAME_LENGTH, PLAYER_COUNT } from '@red10/shared';

// Each test gets a fresh room because the lobby module holds module-level
// state. We use unique socket IDs so rooms don't collide across tests.
let uid = 0;
function freshSocketId(prefix = 'sock'): string {
  return `${prefix}-${++uid}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('validatePlayerName', () => {
  it('accepts a normal name', () => {
    const r = validatePlayerName('Alice');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Alice');
  });

  it('trims whitespace', () => {
    const r = validatePlayerName('  Alice  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Alice');
  });

  it('rejects empty string', () => {
    expect(validatePlayerName('').ok).toBe(false);
    expect(validatePlayerName('   ').ok).toBe(false);
  });

  it('rejects non-string input (attacker sending raw buffer, number, object, null, undefined)', () => {
    expect(validatePlayerName(undefined).ok).toBe(false);
    expect(validatePlayerName(null).ok).toBe(false);
    expect(validatePlayerName(42).ok).toBe(false);
    expect(validatePlayerName({ toString: () => 'Alice' }).ok).toBe(false);
    expect(validatePlayerName(['Alice']).ok).toBe(false);
  });

  it('rejects names longer than MAX_NAME_LENGTH — prevents broadcast amplification', () => {
    const tooLong = 'x'.repeat(MAX_NAME_LENGTH + 1);
    expect(validatePlayerName(tooLong).ok).toBe(false);
    // 1MB name as an adversary would try
    expect(validatePlayerName('a'.repeat(1_000_000)).ok).toBe(false);
  });

  it('accepts exactly MAX_NAME_LENGTH chars', () => {
    const boundary = 'x'.repeat(MAX_NAME_LENGTH);
    const r = validatePlayerName(boundary);
    expect(r.ok).toBe(true);
  });
});

describe('verifyReconnectToken — constant-time token match', () => {
  it('matches identical tokens', () => {
    const tok = 'abcdef0123456789'.repeat(4); // 64 hex chars
    expect(verifyReconnectToken(tok, tok)).toBe(true);
  });

  it('rejects different tokens of same length', () => {
    const a = '0'.repeat(64);
    const b = '1'.repeat(64);
    expect(verifyReconnectToken(a, b)).toBe(false);
  });

  it('rejects tokens of different length', () => {
    expect(verifyReconnectToken('abcd', 'abcde')).toBe(false);
    expect(verifyReconnectToken('abcd', 'abc')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(verifyReconnectToken('abcd', undefined)).toBe(false);
    expect(verifyReconnectToken('abcd', null)).toBe(false);
    expect(verifyReconnectToken('abcd', 1234 as unknown)).toBe(false);
    expect(verifyReconnectToken('abcd', { length: 4 } as unknown)).toBe(false);
  });

  it('rejects empty tokens so a missing server secret can never accidentally authenticate', () => {
    expect(verifyReconnectToken('', '')).toBe(false);
    expect(verifyReconnectToken('abcd', '')).toBe(false);
  });
});

describe('createRoom / joinRoom — issue reconnect tokens', () => {
  it('createRoom issues a 64-char hex token', () => {
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'Alice');
    const host = room.players.get(hostSocket)!;
    expect(host.reconnectToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('joinRoom issues a distinct token for each joining player', () => {
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'Alice');
    const bobSocket = freshSocketId('bob');
    const r = joinRoom(room.id, bobSocket, 'Bob');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.player.reconnectToken).toMatch(/^[0-9a-f]{64}$/);
    // Distinct from host's
    const host = room.players.get(hostSocket)!;
    expect(r.player.reconnectToken).not.toBe(host.reconnectToken);
  });

  it('joinRoom rejects a duplicate display name — prevents by-name rejoin ambiguity', () => {
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'Alice');
    const r = joinRoom(room.id, freshSocketId('dup'), 'Alice');
    expect(r.success).toBe(false);
  });
});

describe('findDisconnectedPlayerForRejoin — THE session-hijack boundary', () => {
  let roomId: string;
  let aliceSocket: string;
  let aliceToken: string;

  beforeEach(() => {
    aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    const alice = room.players.get(aliceSocket)!;
    aliceToken = alice.reconnectToken;
    roomId = room.id;
    // Alice disconnects
    handleDisconnect(aliceSocket);
  });

  it('accepts rejoin with correct name + correct token', () => {
    const hit = findDisconnectedPlayerForRejoin(roomId, 'Alice', aliceToken);
    expect(hit).not.toBeNull();
    expect(hit!.player.name).toBe('Alice');
  });

  it('REJECTS rejoin when token is missing (attacker knows name, not token)', () => {
    // This is the original bug — an attacker who learned the name could take the seat.
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', undefined)).toBeNull();
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', '')).toBeNull();
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', null)).toBeNull();
  });

  it('REJECTS rejoin when token is wrong', () => {
    const wrongToken = '0'.repeat(64);
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', wrongToken)).toBeNull();
  });

  it('REJECTS rejoin with a token from a different player in the same room', () => {
    // Add Bob, disconnect Alice, try to rejoin as Alice using Bob's token.
    const bobSocket = freshSocketId('bob');
    const bobJoin = joinRoom(roomId, bobSocket, 'Bob');
    if (!bobJoin.success) throw new Error('Bob failed to join');
    const bobToken = bobJoin.player.reconnectToken;
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', bobToken)).toBeNull();
  });

  it('REJECTS rejoin when player is still connected', () => {
    // Re-add Alice as connected (simulate re-lobbying), then try rejoin
    // — should fail because she's not disconnected.
    const freshSocket = freshSocketId('alice2');
    handleReconnect(aliceSocket, freshSocket, roomId);
    expect(findDisconnectedPlayerForRejoin(roomId, 'Alice', aliceToken)).toBeNull();
  });

  it('REJECTS rejoin for a non-existent room', () => {
    expect(findDisconnectedPlayerForRejoin('ZZZZ', 'Alice', aliceToken)).toBeNull();
  });

  it('REJECTS rejoin for a non-existent player name even with a valid token from another room', () => {
    // Token is valid format but doesn't belong to anyone named Mallory.
    expect(findDisconnectedPlayerForRejoin(roomId, 'Mallory', aliceToken)).toBeNull();
  });
});

describe('handleReconnect — rotates token on every successful reconnect', () => {
  it('issues a fresh token after each successful reconnect', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    const firstToken = room.players.get(aliceSocket)!.reconnectToken;

    // Disconnect + reconnect
    handleDisconnect(aliceSocket);
    const newSocket = freshSocketId('alice2');
    const res = handleReconnect(aliceSocket, newSocket, room.id);
    expect(res).not.toBeNull();
    const rotatedToken = res!.player.reconnectToken;

    // Must be a fresh, different 64-char hex
    expect(rotatedToken).not.toBe(firstToken);
    expect(rotatedToken).toMatch(/^[0-9a-f]{64}$/);

    // The old token is now useless — replay should fail.
    handleDisconnect(newSocket);
    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', firstToken)).toBeNull();
    // But the rotated token still works.
    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', rotatedToken)).not.toBeNull();
  });
});

describe('token-based rejoin remains strict — guessed/forged tokens still rejected', () => {
  it('the token boundary is intact even though the join-by-name path exists alongside it', () => {
    // Alice creates a room and disconnects. The token-based rejoin path
    // (used by `room:rejoin` for automatic page-reload restores) must still
    // require her actual token; the looser join-by-name path is a separate
    // entry point and not tested here.
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    handleDisconnect(aliceSocket);

    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', undefined)).toBeNull();
    const guess = 'deadbeef'.repeat(8);
    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', guess)).toBeNull();
    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', '')).toBeNull();

    // Alice (holding her actual token) CAN still reconnect via this path.
    const aliceToken = getRoom(room.id)!.players.get(aliceSocket)!.reconnectToken;
    expect(findDisconnectedPlayerForRejoin(room.id, 'Alice', aliceToken)).not.toBeNull();
  });
});

describe('findDisconnectedPlayerByName — name+room rejoin policy', () => {
  it('returns the disconnected player when name matches', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    handleDisconnect(aliceSocket);

    const hit = findDisconnectedPlayerByName(room.id, 'Alice');
    expect(hit).not.toBeNull();
    expect(hit!.player.name).toBe('Alice');
    expect(hit!.oldSocketId).toBe(aliceSocket);
  });

  it('returns null when the matching player is still connected (cannot evict an active seat)', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    // Alice is still connected — name match must NOT match her.
    expect(findDisconnectedPlayerByName(room.id, 'Alice')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    handleDisconnect(aliceSocket);
    expect(findDisconnectedPlayerByName(room.id, 'Mallory')).toBeNull();
  });

  it('returns null for an unknown room', () => {
    expect(findDisconnectedPlayerByName('ZZZZ', 'Alice')).toBeNull();
  });

  it('matches the disconnected slot even when other players in the same room are still connected', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    const bobSocket = freshSocketId('bob');
    joinRoom(room.id, bobSocket, 'Bob');
    handleDisconnect(bobSocket);

    // Alice is still connected (no match), Bob is disconnected (match).
    expect(findDisconnectedPlayerByName(room.id, 'Alice')).toBeNull();
    const hit = findDisconnectedPlayerByName(room.id, 'Bob');
    expect(hit).not.toBeNull();
    expect(hit!.oldSocketId).toBe(bobSocket);
  });
});

describe('joinRoom — disconnected seats are reserved (room can never overflow PLAYER_COUNT)', () => {
  it('rejects a new joiner while a disconnected player still holds a seat', () => {
    // Fill the room: host + 5 joiners = 6 total.
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'P0');
    for (let i = 1; i < PLAYER_COUNT; i++) {
      const r = joinRoom(room.id, freshSocketId(`p${i}`), `P${i}`);
      expect(r.success).toBe(true);
    }
    expect(room.players.size).toBe(PLAYER_COUNT);

    // One player drops. They keep their seat for the reconnect window.
    handleDisconnect([...room.players.keys()][3]);
    expect(room.players.size).toBe(PLAYER_COUNT);

    // A new joiner must NOT be allowed to slip in — that's exactly the bug
    // that produced a 7-row lobby with seat indices going up to 6 and made
    // GameEngine.startGame throw on a missing hand slot.
    const r = joinRoom(room.id, freshSocketId('overflow'), 'Overflow');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/full/i);
    expect(room.players.size).toBe(PLAYER_COUNT);
  });

  it('lets a new joiner take a freed seat once the reconnect window evicts the disconnected player', () => {
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'P0');
    for (let i = 1; i < PLAYER_COUNT; i++) {
      joinRoom(room.id, freshSocketId(`p${i}`), `P${i}`);
    }
    // Manually evict (simulates the 60s timer firing) by deleting from the
    // map. We don't expose the internal removal helper, so we lean on the
    // observable contract: once size drops below PLAYER_COUNT, joins succeed.
    const droppedSocket = [...room.players.keys()][2];
    room.players.delete(droppedSocket);

    const r = joinRoom(room.id, freshSocketId('replacement'), 'Replacement');
    expect(r.success).toBe(true);
  });

  it('addBotToRoom respects the same total-slot cap', () => {
    const hostSocket = freshSocketId('host');
    const room = createRoom(hostSocket, 'P0');
    for (let i = 1; i < PLAYER_COUNT; i++) {
      joinRoom(room.id, freshSocketId(`p${i}`), `P${i}`);
    }
    // Drop one — seat held for reconnect.
    handleDisconnect([...room.players.keys()][1]);

    // A bot fill must not push us over PLAYER_COUNT either.
    const bot = addBotToRoom(room.id, 'bot-1', 'Botty');
    expect(bot).toBeNull();
    expect(room.players.size).toBe(PLAYER_COUNT);
  });
});

describe('setOnPlayerRemoved — eviction broadcast hook fires after the reconnect window', () => {
  it('invokes the registered callback when a disconnected player is evicted', async () => {
    vi.useFakeTimers();
    try {
      const removed: Array<{ roomId: string; socketId: string }> = [];
      setOnPlayerRemoved((roomId, socketId) => {
        removed.push({ roomId, socketId });
      });

      const hostSocket = freshSocketId('host');
      const room = createRoom(hostSocket, 'Solo');
      handleDisconnect(hostSocket);

      // Reconnect window is 60s — fast-forward past it to fire the timer.
      await vi.advanceTimersByTimeAsync(61_000);

      expect(removed).toEqual([{ roomId: room.id, socketId: hostSocket }]);
    } finally {
      setOnPlayerRemoved(null);
      vi.useRealTimers();
    }
  });
});

describe('getRoomForSocket — still works after our changes', () => {
  it('returns the room for a player by their socket id', () => {
    const aliceSocket = freshSocketId('alice');
    const room = createRoom(aliceSocket, 'Alice');
    expect(getRoomForSocket(aliceSocket)?.id).toBe(room.id);
  });
});
