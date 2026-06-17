import { Injectable } from '@nestjs/common';
import { MatchMode } from './entities/match.entity';
import { createGameMap } from './game-map';
import { CurlingSnapshot, MatchRoom, RoomPlayer, SocketUser } from './matchmaking.types';

const TOTAL_ENDS = 3;
const STONES_PER_PLAYER = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

const HOUSE_CX = (1570 - 380) / 1570;
const HOUSE_CY = 0.5;
const HOUSE_R_SRC = 220;
const SHEET_W_SRC = 1570;
const SHEET_H_SRC = 880;

interface SettledObject {
  id: number;
  side: number;
  x: number;
  y: number;
  power: string;
  trail?: Array<{ x: number; y: number }>;
}

@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, MatchRoom>();
  private readonly userRoom = new Map<number, string>();

  createRoom(
    matchId: string,
    gameId: string,
    mode: MatchMode,
    players: Array<{ socketId: string; user: SocketUser; shellSelection: string[] }>,
  ): MatchRoom {
    const roomPlayers = players.slice(0, MAX_PLAYERS).map((player, index) => ({
      ...player,
      side: index,
      ready: false,
      connected: true,
    }));
    const playerCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, roomPlayers.length));
    const maxTurns = playerCount * STONES_PER_PLAYER * TOTAL_ENDS;

    const snapshot: CurlingSnapshot = {
      matchId,
      seq: 0,
      gameId,
      mode,
      phase: 'pending',
      currentTurn: 0,
      turnNumber: 0,
      maxTurns,
      currentEnd: 0,
      throwsInEnd: 0,
      stonesPerPlayer: STONES_PER_PLAYER,
      totalEnds: TOTAL_ENDS,
      score: Array.from({ length: playerCount }, () => 0),
      map: createGameMap(gameId),
      players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
      objects: [],
      winnerSide: null,
    };

    const room: MatchRoom = {
      matchId,
      gameId,
      mode,
      status: 'pending',
      players: roomPlayers,
      spectators: new Map(),
      seq: 0,
      state: snapshot,
    };

    this.rooms.set(matchId, room);
    for (const player of roomPlayers) this.userRoom.set(player.user.id, matchId);
    return room;
  }

  getRoom(matchId: string): MatchRoom | null {
    return this.rooms.get(matchId) ?? null;
  }

  getRoomForUser(userId: number): MatchRoom | null {
    const matchId = this.userRoom.get(userId);
    return matchId ? this.getRoom(matchId) : null;
  }

  hasActiveRoom(userId: number): boolean {
    const room = this.getRoomForUser(userId);
    return !!room && room.status !== 'finished' && room.status !== 'abandoned';
  }

  setReady(matchId: string, userId: number): MatchRoom | null {
    const room = this.getRoom(matchId);
    const player = room?.players.find((p) => p.user.id === userId);
    if (!room || !player) return null;
    player.ready = true;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  start(matchId: string): MatchRoom | null {
    const room = this.getRoom(matchId);
    if (!room) return null;
    room.status = 'active';
    room.state.phase = 'active';
    room.state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  reconnect(socketId: string, user: SocketUser): MatchRoom | null {
    const room = this.getRoomForUser(user.id);
    const player = room?.players.find((p) => p.user.id === user.id);
    if (!room || !player) return null;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.socketId = socketId;
    player.connected = true;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  markDisconnected(socketId: string, onTimeout: (room: MatchRoom, player: RoomPlayer) => void, timeoutMs: number): MatchRoom | null {
    const room = [...this.rooms.values()].find((candidate) =>
      candidate.players.some((player) => player.socketId === socketId),
    );
    const player = room?.players.find((p) => p.socketId === socketId);
    if (!room || !player || room.status === 'finished' || room.status === 'abandoned') return null;

    player.connected = false;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => onTimeout(room, player), timeoutMs);
    this.refreshSnapshotPlayers(room);
    return room;
  }

  addSpectator(matchId: string, socketId: string, user: SocketUser): MatchRoom | null {
    const room = this.getRoom(matchId);
    if (!room || room.status === 'finished' || room.status === 'abandoned') return null;
    room.spectators.set(socketId, user);
    return room;
  }

  removeSpectator(socketId: string): MatchRoom | null {
    for (const room of this.rooms.values()) {
      if (room.spectators.delete(socketId)) return room;
    }
    return null;
  }

  finish(matchId: string, winnerSide: number | null, abandoned = false): MatchRoom | null {
    const room = this.getRoom(matchId);
    if (!room) return null;
    room.status = abandoned ? 'abandoned' : 'finished';
    room.state.phase = abandoned ? 'abandoned' : 'finished';
    room.state.winnerSide = winnerSide;
    room.state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    for (const player of room.players) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      this.userRoom.delete(player.user.id);
    }
    return room;
  }

  applyRelease(matchId: string, userId: number, payload: Record<string, unknown> = {}): MatchRoom | null {
    const room = this.getRoom(matchId);
    const player = room?.players.find((p) => p.user.id === userId);
    if (!room || !player || room.status !== 'active') return null;
    if (player.side !== room.state.currentTurn) return null;
    if (room.state.objects.some((object) => object.id === room.state.turnNumber)) return null;

    const vx = Number(payload.vx ?? 0);
    const vy = Number(payload.vy ?? 0);
    const power = String(payload.power ?? 'none');

    room.state.objects.push({
      id: room.state.turnNumber,
      side: player.side,
      x: 0,
      y: 0.5,
      power,
    });
    room.state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);

    return room;
  }

  applySettled(matchId: string, userId: number, payload: Record<string, unknown> = {}): MatchRoom | null {
    const room = this.getRoom(matchId);
    const player = room?.players.find((p) => p.user.id === userId);
    if (!room || !player || room.status !== 'active') return null;
    if (player.side !== room.state.currentTurn) return null;

    const objects = Array.isArray(payload.objects) ? payload.objects : null;
    if (!objects) return null;

    room.state.objects = objects
      .map((object): SettledObject | null => {
        if (!object || typeof object !== 'object') return null;
        const raw = object as Record<string, unknown>;
        const id = Number(raw.id);
        const side = Number(raw.side);
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (!Number.isFinite(id) || !Number.isFinite(side) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          id,
          side,
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
          power: String(raw.power ?? 'none'),
          trail: Array.isArray(raw.trail) ? raw.trail as Array<{ x: number; y: number }> : undefined,
        };
      })
      .filter((object): object is SettledObject => object !== null);

    room.state.turnNumber += 1;
    room.state.throwsInEnd += 1;

    if (room.state.throwsInEnd >= room.players.length * room.state.stonesPerPlayer) {
      const endScore = this.scoreEnd(room.state.objects);
      if (endScore.scoringSide !== null) room.state.score[endScore.scoringSide] += endScore.points;
      room.state.currentEnd += 1;
      room.state.throwsInEnd = 0;
      room.state.objects = [];
    }

    room.state.currentTurn = this.nextTurn(room);
    room.state.seq = ++room.seq;

    if (room.state.currentEnd >= room.state.totalEnds || room.state.turnNumber >= room.state.maxTurns) {
      this.finish(matchId, this.getWinnerSide(room.state.score));
    }

    return room;
  }

  private nextTurn(room: MatchRoom): number {
    if (room.state.throwsInEnd === 0) return 0;
    return (room.state.currentTurn + 1) % room.players.length;
  }

  private scoreEnd(objects: SettledObject[]): { scoringSide: number | null; points: number } {
    const inHouse = objects.filter((object) => this.isInHouse(object));
    if (!inHouse.length) return { scoringSide: null, points: 0 };

    let bestDist = Infinity;
    let scoringSide = inHouse[0].side;
    for (const object of inHouse) {
      const d = this.distanceToButton(object);
      if (d < bestDist) {
        bestDist = d;
        scoringSide = object.side;
      }
    }

    const opponentDist = inHouse
      .filter((object) => object.side !== scoringSide)
      .map((object) => this.distanceToButton(object))
      .reduce((min, d) => Math.min(min, d), Infinity);
    const points = inHouse.filter((object) => object.side === scoringSide && this.distanceToButton(object) < opponentDist).length;
    return { scoringSide, points };
  }

  private isInHouse(object: SettledObject): boolean {
    return this.distanceToButton(object) <= HOUSE_R_SRC;
  }

  private distanceToButton(object: SettledObject): number {
    const dx = (object.x - HOUSE_CX) * SHEET_W_SRC;
    const dy = (object.y - HOUSE_CY) * SHEET_H_SRC;
    return Math.hypot(dx, dy);
  }

  private getWinnerSide(score: number[]): number | null {
    const maxScore = Math.max(...score);
    const winners = score.map((value, side) => ({ value, side })).filter((entry) => entry.value === maxScore);
    return winners.length === 1 ? winners[0].side : null;
  }

  private refreshSnapshotPlayers(room: MatchRoom): void {
    room.state.players = room.players.map((player) => this.toSnapshotPlayer(player));
    room.state.seq = room.seq;
  }

  private toSnapshotPlayer(player: RoomPlayer): CurlingSnapshot['players'][number] {
    return {
      side: player.side,
      userId: player.user.id,
      username: player.user.username,
      connected: player.connected,
      ready: player.ready,
    };
  }
}
