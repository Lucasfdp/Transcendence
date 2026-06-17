import { io, Socket } from 'socket.io-client';

export type MatchMode = 'casual' | 'ranked';

export type GameMap =
  | { gameId: 'shell-curl'; bumpers: Array<{ fx: number; fy: number }> }
  | { gameId: string };

export interface CurlingSnapshot {
  matchId: string;
  seq: number;
  gameId: string;
  mode: MatchMode;
  phase: 'pending' | 'active' | 'finished' | 'abandoned';
  currentTurn: number;
  turnNumber: number;
  maxTurns: number;
  currentEnd: number;
  throwsInEnd: number;
  stonesPerPlayer: number;
  totalEnds: number;
  score: number[];
  map: GameMap;
  players: Array<{
    side: number;
    userId: number | null;
    username: string;
    connected: boolean;
    ready: boolean;
  }>;
  objects: Array<{
    id: number;
    side: number;
    x: number;
    y: number;
    power: string;
    trail?: Array<{ x: number; y: number }>;
  }>;
  winnerSide: number | null;
}

export interface CurlingThrowEvent {
  matchId: string;
  id: number;
  side: number;
  vx: number;
  vy: number;
  power: string;
}

export interface OnlineMatchContext {
  matchId: string;
  side: number;
  spectator?: boolean;
  snapshot?: CurlingSnapshot;
}

let socket: Socket | null = null;

export function getGameSocket(): Socket {
  if (socket) return socket;
  socket = io('/', {
    path: '/ws/',
    withCredentials: true,
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectGameSocket(): void {
  socket?.disconnect();
  socket = null;
}
