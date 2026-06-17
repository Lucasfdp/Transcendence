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

export interface SnapshotPlayer {
  side: number;
  userId: number | null;
  username: string;
  connected: boolean;
  ready: boolean;
}

export interface BambooBashSnapshot {
  matchId: string;
  seq: number;
  gameId: 'bamboo-bash';
  mode: MatchMode;
  phase: 'pending' | 'active' | 'finished' | 'abandoned';
  roundNumber: number;
  totalRounds: number;
  roundTimeMs: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  score: number[];
  liveRoundScores: number[];
  roundScores: Array<number | null>;
  bamboos: Array<{ id: number; nx: number; ny: number; stage: number; ageMs: number }>;
  nextBambooId: number;
  spawnAccMs: number;
  lastBambooUpdateAt: number | null;
  players: SnapshotPlayer[];
  winnerSide: number | null;
}

export type GameSnapshot = CurlingSnapshot | BambooBashSnapshot;

export interface CurlingThrowEvent {
  matchId: string;
  id: number;
  side: number;
  vx: number;
  vy: number;
  power: string;
}

export interface BambooBashThrowEvent {
  matchId: string;
  roundNumber: number;
  side: number;
  vx: number;
  vy: number;
  power: string;
}

export interface OnlineMatchContext {
  matchId: string;
  side: number;
  spectator?: boolean;
  snapshot?: GameSnapshot;
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
