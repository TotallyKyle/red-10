import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents, ClientGameView, Card, PlayFormat, Rank, Team, GameLogEntryData } from '@red10/shared';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RoomPlayer {
  id: string;
  name: string;
  seatIndex: number;
  isReady: boolean;
  isConnected: boolean;
}

export interface RoomState {
  roomId: string;
  players: RoomPlayer[];
  hostId: string | null;
  isHost: boolean;
}

export interface GameLogEntry {
  id: number;
  timestamp: number;
  type: 'play' | 'pass' | 'round_won' | 'round_new' | 'cha_go' | 'bomb_defused' | 'team_revealed' | 'double' | 'player_out' | 'game_scored';
  message: string;
}

/**
 * The cards + player that just resolved the previous round. Rendered in the
 * center play area so a go-cha winner doesn't vanish the instant the engine
 * starts the next round. `type` distinguishes sources for future overlays;
 * only 'go_cha' is emitted today.
 */
export interface RoundEndDisplay {
  cards: Card[];
  playerId: string;
  type: 'go_cha';
}

const ROUND_END_HOLD_MS = 3500;

export interface UseSocketReturn {
  isConnected: boolean;
  roomState: RoomState | null;
  gameView: ClientGameView | null;
  errorMessage: string | null;
  gameLog: GameLogEntry[];
  createRoom: (name: string) => void;
  joinRoom: (roomId: string, name: string) => void;
  toggleReady: () => void;
  startGame: () => void;
  fillWithBots: () => void;
  playCards: (cards: Card[]) => void;
  passAction: () => void;
  defuseAction: (cards: Card[]) => void;
  chaAction: (cards: Card[]) => void;
  goChaAction: (cards: Card[]) => void;
  declineChaAction: () => void;
  declareDouble: (bombCards?: Card[]) => void;
  skipDoubleAction: () => void;
  declareQuadruple: () => void;
  skipQuadrupleAction: () => void;
  playAgain: () => void;
  /** Fetch the current game log from the server and trigger a download. */
  downloadGameLog: () => void;
  mySocketId: string | null;
  turnStartTime: number | null;
  /** Non-null briefly after a cha-go win so the PlayArea can show the winning cards. */
  roundEndDisplay: RoundEndDisplay | null;
}

// Helper to resolve a player name from the game view
function getPlayerName(gameView: ClientGameView | null, playerId: string): string {
  if (!gameView) return playerId.slice(0, 8);
  const player = gameView.players.find((p) => p.id === playerId);
  return player?.name ?? playerId.slice(0, 8);
}

function formatCards(cards: Card[]): string {
  return cards.map((c) => `${c.rank}${c.isRed ? '♥' : '♠'}`).join(' ');
}

const FORMAT_NAMES: Record<PlayFormat, string> = {
  single: 'single',
  pair: 'pair',
  straight: 'straight',
  paired_straight: 'paired straight',
  bomb: 'BOMB',
};

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<TypedSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameView, setGameView] = useState<ClientGameView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [turnStartTime, setTurnStartTime] = useState<number | null>(null);
  const [roundEndDisplay, setRoundEndDisplay] = useState<RoundEndDisplay | null>(null);
  const roundEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track players and ready states locally since server sends incremental events
  const playersRef = useRef<RoomPlayer[]>([]);
  // Persist room/name/reconnectToken in sessionStorage so we survive HMR and
  // page reloads. The token is a per-player secret issued by the server on
  // join/create; without it, rejoin is rejected even if you know the name.
  const roomIdRef = useRef<string | null>(sessionStorage.getItem('red10_roomId'));
  const hostIdRef = useRef<string | null>(null);
  const myNameRef = useRef<string | null>(sessionStorage.getItem('red10_myName'));
  const reconnectTokenRef = useRef<string | null>(sessionStorage.getItem('red10_reconnectToken'));
  const gameViewRef = useRef<ClientGameView | null>(null);
  const logIdRef = useRef(0);

  const clearStoredSession = useCallback(() => {
    sessionStorage.removeItem('red10_roomId');
    sessionStorage.removeItem('red10_myName');
    sessionStorage.removeItem('red10_reconnectToken');
    roomIdRef.current = null;
    myNameRef.current = null;
    reconnectTokenRef.current = null;
  }, []);

  const storeSession = useCallback((roomId: string, name: string, token: string) => {
    sessionStorage.setItem('red10_roomId', roomId);
    sessionStorage.setItem('red10_myName', name);
    sessionStorage.setItem('red10_reconnectToken', token);
    roomIdRef.current = roomId;
    myNameRef.current = name;
    reconnectTokenRef.current = token;
  }, []);

  // Keep gameViewRef in sync
  useEffect(() => {
    gameViewRef.current = gameView;
  }, [gameView]);

  const addLogEntry = useCallback((type: GameLogEntry['type'], message: string) => {
    const entry: GameLogEntry = {
      id: ++logIdRef.current,
      timestamp: Date.now(),
      type,
      message,
    };
    setGameLog((prev) => [...prev, entry]);
  }, []);

  const updateRoomState = useCallback((roomId: string, players: RoomPlayer[]) => {
    const socket = socketRef.current;
    setRoomState({
      roomId,
      players,
      hostId: hostIdRef.current,
      isHost: hostIdRef.current === socket?.id,
    });
  }, []);

  useEffect(() => {
    // Socket.IO target URL resolution:
    //   - If `VITE_API_URL` is set at build time, connect to that explicit URL.
    //     Use this when the client is deployed separately from the server
    //     (e.g., client on Vercel, server on Fly.io).
    //   - Otherwise, connect to the page's own origin (same-host deploy or
    //     Vite's dev-time proxy for /socket.io).
    const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
    const socket: TypedSocket = apiUrl
      ? io(apiUrl, { autoConnect: true, reconnection: true, transports: ['websocket', 'polling'] })
      : io({ autoConnect: true, reconnection: true });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setMySocketId(socket.id ?? null);

      // Attempt rejoin if we have stored room info (survives HMR/page reload).
      // We ONLY attempt a rejoin when we also have the per-player reconnect
      // token — without it, the server will reject us (and should).
      const storedRoomId = roomIdRef.current;
      const storedName = myNameRef.current;
      const storedToken = reconnectTokenRef.current;
      if (storedRoomId && storedName && storedToken) {
        // Reset player list — server will send fresh data via room:player_joined events
        playersRef.current = [];
        socket.emit(
          'room:rejoin',
          { roomId: storedRoomId, playerName: storedName, reconnectToken: storedToken },
          (res) => {
            if (res.success) {
              console.log(`Successfully rejoined room ${storedRoomId}`);
              // Server rotated the token on successful rejoin. Persist the new one
              // so a subsequent reload works and a stale token can't be replayed.
              if (res.reconnectToken) {
                sessionStorage.setItem('red10_reconnectToken', res.reconnectToken);
                reconnectTokenRef.current = res.reconnectToken;
              }
            } else {
              console.log(`Rejoin failed: ${res.error}, clearing stored room`);
              clearStoredSession();
            }
          },
        );
      } else if (storedRoomId || storedName || storedToken) {
        // Inconsistent stored state (missing token) — clear everything.
        clearStoredSession();
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('error', (data) => {
      setErrorMessage(data.message);
      setTimeout(() => setErrorMessage(null), 5000);
    });

    socket.on('room:player_joined', (data) => {
      // Update host from server
      hostIdRef.current = data.hostId;

      const existingIdx = playersRef.current.findIndex((p) => p.id === data.player.id);
      if (existingIdx === -1) {
        playersRef.current = [
          ...playersRef.current,
          {
            id: data.player.id,
            name: data.player.name,
            seatIndex: playersRef.current.length,
            isReady: false,
            isConnected: true,
          },
        ];
      }
      if (roomIdRef.current) {
        updateRoomState(roomIdRef.current, [...playersRef.current]);
      }
    });

    socket.on('room:player_ready', (data) => {
      // Toggle the ready state — the server sends this event each time a player toggles
      playersRef.current = playersRef.current.map((p) => {
        if (p.id !== data.playerId) return p;
        return { ...p, isReady: !p.isReady };
      });
      if (roomIdRef.current) {
        updateRoomState(roomIdRef.current, [...playersRef.current]);
      }
    });

    socket.on('room:host_changed', (data) => {
      hostIdRef.current = data.hostId;
      if (roomIdRef.current) {
        updateRoomState(roomIdRef.current, [...playersRef.current]);
      }
    });

    socket.on('room:player_left', (data) => {
      playersRef.current = playersRef.current.map((p) =>
        p.id === data.playerId ? { ...p, isConnected: false, isReady: false } : p,
      );
      if (roomIdRef.current) {
        updateRoomState(roomIdRef.current, [...playersRef.current]);
      }
    });

    socket.on('game:state', (view) => {
      setGameView(view);
      // Reset turn timer on new state
      if (view.phase === 'playing' && view.round) {
        setTurnStartTime(Date.now());
      } else {
        setTurnStartTime(null);
      }
      // A new play landed in the next round — clear the round-end overlay
      // early rather than waiting out the hold timer.
      if (view.round?.lastPlay) {
        if (roundEndTimerRef.current) {
          clearTimeout(roundEndTimerRef.current);
          roundEndTimerRef.current = null;
        }
        setRoundEndDisplay(null);
      }
    });

    socket.on('game:update', (view) => {
      setGameView((prev) => (prev ? { ...prev, ...view } : null));
    });

    // Animation/notification events - populate game log
    socket.on('play:made', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      const formatName = FORMAT_NAMES[data.format] ?? data.format;
      const msg = `${name} played ${formatName}: ${formatCards(data.cards)}`;
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'play', message: msg }]);
    });

    socket.on('player:passed', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'pass', message: `${name} passed` }]);
    });

    socket.on('round:won', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.winnerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'round_won', message: `${name} won the round` }]);
    });

    socket.on('round:new', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.leaderId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'round_new', message: `New round - ${name} leads` }]);
    });

    socket.on('player:out', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'player_out', message: `${name} finished #${data.finishOrder}` }]);
    });

    socket.on('bomb:defused', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.defuserId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'bomb_defused', message: `${name} defused the bomb!` }]);
    });

    socket.on('team:revealed', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      const team = data.team === 'red10' ? 'Red' : 'Black';
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'team_revealed', message: `${name} revealed as ${team} team${data.red10Count ? ` (${data.red10Count} red 10s)` : ''}` }]);
    });

    socket.on('cha_go:started', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.chaPlayerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'cha_go', message: `${name} declared Cha on ${data.rank}!` }]);
    });

    socket.on('cha_go:opportunity', (data) => {
      // Don't log to game log, this is personal
    });

    socket.on('cha_go:go_cha', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'cha_go', message: `${name} played Go-Cha!` }]);
      // The engine wipes round.lastPlay the instant the go-cha resolves, so
      // without this the winning cards would disappear from the table before
      // anyone could read them. Hold them locally for a few seconds.
      if (roundEndTimerRef.current) clearTimeout(roundEndTimerRef.current);
      setRoundEndDisplay({ cards: data.cards, playerId: data.playerId, type: 'go_cha' });
      roundEndTimerRef.current = setTimeout(() => {
        setRoundEndDisplay(null);
        roundEndTimerRef.current = null;
      }, ROUND_END_HOLD_MS);
    });

    socket.on('double:declared', (data) => {
      const gv = gameViewRef.current;
      const name = getPlayerName(gv, data.playerId);
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'double', message: `${name} doubled the stakes!` }]);
    });

    socket.on('game:scored', (result) => {
      const team = result.scoringTeam === 'red10' ? 'Red' : 'Black';
      const msg = result.scoringTeamWon
        ? `${team} team wins! ${result.trapped.length} player(s) trapped.`
        : `${team} team failed to trap anyone.`;
      setGameLog((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: 'game_scored', message: msg }]);
    });

    socket.on('game:log_entry', (entry: GameLogEntryData) => {
      // Server-side log entries are also appended to local log
      // We already get client-side events, so only add if it contains new info (e.g., from bots)
      // Skip duplicates by not adding — the client-side events handle human actions
    });

    return () => {
      socket.disconnect();
      if (roundEndTimerRef.current) {
        clearTimeout(roundEndTimerRef.current);
        roundEndTimerRef.current = null;
      }
    };
  }, [updateRoomState]);

  const createRoom = useCallback((name: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    setErrorMessage(null);
    setGameLog([]);

    socket.emit('room:create', { playerName: name }, (res) => {
      if (!res.success || !res.roomId || !res.reconnectToken) {
        setErrorMessage(res.error ?? 'Failed to create room');
        setTimeout(() => setErrorMessage(null), 5000);
        return;
      }
      storeSession(res.roomId, name, res.reconnectToken);
      hostIdRef.current = socket.id!; // Creator is always the host
      playersRef.current = [
        {
          id: socket.id!,
          name,
          seatIndex: 0,
          isReady: false,
          isConnected: true,
        },
      ];
      updateRoomState(res.roomId, [...playersRef.current]);
    });
  }, [updateRoomState, storeSession]);

  const joinRoom = useCallback((roomId: string, name: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    setErrorMessage(null);
    setGameLog([]);

    const normalizedRoomId = roomId.toUpperCase();
    socket.emit('room:join', { roomId: normalizedRoomId, playerName: name }, (res) => {
      if (res.success && res.reconnectToken) {
        storeSession(normalizedRoomId, name, res.reconnectToken);
        // The player list will be built up from room:player_joined events
        // We add ourselves initially
        if (!playersRef.current.find((p) => p.id === socket.id)) {
          playersRef.current = [
            ...playersRef.current,
            {
              id: socket.id!,
              name,
              seatIndex: playersRef.current.length,
              isReady: false,
              isConnected: true,
            },
          ];
        }
        updateRoomState(normalizedRoomId, [...playersRef.current]);
      } else {
        setErrorMessage(res.error ?? 'Failed to join room');
      }
    });
  }, [updateRoomState, storeSession]);

  const toggleReady = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('room:ready');
  }, []);

  const startGame = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('room:start');
  }, []);

  const fillWithBots = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('room:fill_bots', (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Failed to fill with bots');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const downloadGameLog = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    // Always fetch a FRESH log from the server — never rely on cached state,
    // since "Play Again" creates a new logger on the server and the client's
    // last downloaded text would be stale otherwise.
    socket.emit('game:get_log', (res) => {
      const logText = res.log;
      if (!logText) return;
      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `red10-game-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, []);

  const playCards = useCallback((cards: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('play:cards', { cards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Play failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const passAction = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('play:pass');
  }, []);

  const defuseAction = useCallback((cards: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('play:defuse', { cards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Defuse failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const chaAction = useCallback((cards: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('play:cha', { cards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Cha failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const goChaAction = useCallback((cards: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('play:go_cha', { cards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Go-cha failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const declineChaAction = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('cha:decline');
  }, []);

  const declareDouble = useCallback((bombCards?: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('double:declare', { bombCards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Double failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const skipDoubleAction = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('double:skip');
  }, []);

  const declareQuadruple = useCallback((bombCards?: Card[]) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('quadruple:declare', { bombCards }, (res) => {
      if (!res.success) {
        setErrorMessage(res.error ?? 'Quadruple failed');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }, []);

  const skipQuadrupleAction = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('quadruple:skip');
  }, []);

  const playAgain = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('game:play_again');
  }, []);

  return {
    isConnected,
    roomState,
    gameView,
    errorMessage,
    gameLog,
    createRoom,
    joinRoom,
    toggleReady,
    startGame,
    fillWithBots,
    playCards,
    passAction,
    defuseAction,
    chaAction,
    goChaAction,
    declineChaAction,
    declareDouble,
    skipDoubleAction,
    declareQuadruple,
    skipQuadrupleAction,
    playAgain,
    downloadGameLog,
    mySocketId,
    turnStartTime,
    roundEndDisplay,
  };
}
