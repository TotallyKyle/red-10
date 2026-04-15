import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents, ClientGameView, Card } from '@red10/shared';

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

export interface UseSocketReturn {
  isConnected: boolean;
  roomState: RoomState | null;
  gameView: ClientGameView | null;
  errorMessage: string | null;
  createRoom: (name: string) => void;
  joinRoom: (roomId: string, name: string) => void;
  toggleReady: () => void;
  startGame: () => void;
  playCards: (cards: Card[]) => void;
  passAction: () => void;
  mySocketId: string | null;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<TypedSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameView, setGameView] = useState<ClientGameView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  // Track players and ready states locally since server sends incremental events
  const playersRef = useRef<RoomPlayer[]>([]);
  const roomIdRef = useRef<string | null>(null);
  const hostIdRef = useRef<string | null>(null);
  const myNameRef = useRef<string | null>(null);

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
    const socket: TypedSocket = io({
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setMySocketId(socket.id ?? null);
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
    });

    socket.on('game:update', (view) => {
      setGameView((prev) => (prev ? { ...prev, ...view } : null));
    });

    // Animation/notification events - log for now
    socket.on('play:made', (data) => {
      console.log(`[play:made] ${data.playerId} played ${data.cards.length} card(s) as ${data.format}`);
    });

    socket.on('player:passed', (data) => {
      console.log(`[player:passed] ${data.playerId} passed`);
    });

    socket.on('round:won', (data) => {
      console.log(`[round:won] Winner: ${data.winnerId}`);
    });

    socket.on('round:new', (data) => {
      console.log(`[round:new] Leader: ${data.leaderId}`);
    });

    socket.on('player:out', (data) => {
      console.log(`[player:out] ${data.playerId} finished #${data.finishOrder}`);
    });

    return () => {
      socket.disconnect();
    };
  }, [updateRoomState]);

  const createRoom = useCallback((name: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    setErrorMessage(null);
    myNameRef.current = name;

    socket.emit('room:create', { playerName: name }, (res) => {
      roomIdRef.current = res.roomId;
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
  }, [updateRoomState]);

  const joinRoom = useCallback((roomId: string, name: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    setErrorMessage(null);
    myNameRef.current = name;

    socket.emit('room:join', { roomId: roomId.toUpperCase(), playerName: name }, (res) => {
      if (res.success) {
        roomIdRef.current = roomId.toUpperCase();
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
        updateRoomState(roomId.toUpperCase(), [...playersRef.current]);
      } else {
        setErrorMessage(res.error ?? 'Failed to join room');
      }
    });
  }, [updateRoomState]);

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

  return {
    isConnected,
    roomState,
    gameView,
    errorMessage,
    createRoom,
    joinRoom,
    toggleReady,
    startGame,
    playCards,
    passAction,
    mySocketId,
  };
}
