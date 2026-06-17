import { MatchMode } from './entities/match.entity';
import { GameMap } from './game-map';

export interface SocketUser {
  id: number;
  username: string;
  isGuest: boolean;
}

export interface QueueJoinPayload {
  gameId: string;
  mode: MatchMode;
  playerCount?: number;
  shellSelection?: string[];
}

export interface GameInputPayload {
  matchId: string;
  action: 'aim' | 'power' | 'release' | 'settled';
  payload?: Record<string, unknown>;
}

export interface CurlingThrowEvent {
  matchId: string;
  id: number;
  side: number;
  vx: number;
  vy: number;
  power: string;
}

export interface SpectatorJoinPayload {
  matchId: string;
}

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

export interface RoomPlayer {
  socketId: string;
  user: SocketUser;
  side: number;
  shellSelection: string[];
  ready: boolean;
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

export interface MatchRoom {
  matchId: string;
  gameId: string;
  mode: MatchMode;
  status: 'pending' | 'active' | 'finished' | 'abandoned';
  players: RoomPlayer[];
  spectators: Map<string, SocketUser>;
  seq: number;
  state: CurlingSnapshot;
}
