import { Injectable } from '@nestjs/common';
import { BellClashSnapshot, GameInputPayload, MatchRoom, RoomPlayer, SnapshotPlayer } from '../matchmaking.types';
import { GameEngine, GameEngineCreateContext } from './game-engine';

type BellZoneKind = 'red' | 'yellow' | 'green';

const TOTAL_ROUNDS = 3;
const SHOTS_PER_ROUND = 3;
const ZONE_SPAN = Math.PI * 2 * 0.15;
const TWO_PI = Math.PI * 2;

@Injectable()
export class BellClashEngine implements GameEngine {
  readonly gameId = 'bell-clash';

  createInitialState(context: GameEngineCreateContext, roomPlayers: RoomPlayer[]): BellClashSnapshot {
    return {
      matchId: context.matchId,
      seq: 0,
      gameId: 'bell-clash',
      mode: context.mode,
      phase: 'pending',
      roundNumber: 1,
      totalRounds: TOTAL_ROUNDS,
      shotsPerRound: SHOTS_PER_ROUND,
      score: Array.from({ length: roomPlayers.length }, () => 0),
      liveRoundScores: Array.from({ length: roomPlayers.length }, () => 0),
      roundScores: Array.from({ length: roomPlayers.length }, () => null),
      shotCounts: Array.from({ length: roomPlayers.length }, () => 0),
      zones: [],
      players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
      winnerSide: null,
    };
  }

  start(room: MatchRoom): void {
    const state = room.state as BellClashSnapshot;
    room.status = 'active';
    state.phase = 'active';
    this.resetRound(state, room.players.length);
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
  }

  handleInput(room: MatchRoom, userId: number, input: GameInputPayload): MatchRoom | null {
    if (input.action === 'release') return this.applyRelease(room, userId, input.payload ?? {});
    if (input.action === 'bell:hit') return this.applyBellHit(room, userId, input.payload ?? {});
    if (input.action === 'round:score') return this.applyRoundScore(room, userId, input.payload ?? {});
    return room;
  }

  abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
    const state = room.state as BellClashSnapshot;
    const remaining = room.players
      .filter((player) => player.side !== abandonedPlayer.side && player.connected)
      .map((player) => ({ side: player.side, score: state.score[player.side] ?? 0 }));
    if (!remaining.length) return null;
    const maxScore = Math.max(...remaining.map((entry) => entry.score));
    const winners = remaining.filter((entry) => entry.score === maxScore);
    return winners.length === 1 ? winners[0].side : null;
  }

  private applyRelease(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as BellClashSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;
    if (state.roundScores[player.side] !== null) return null;
    if ((state.shotCounts[player.side] ?? 0) >= state.shotsPerRound) return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    const vx = Number(payload.vx);
    const vy = Number(payload.vy);
    if (roundNumber !== state.roundNumber) return null;
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;

    state.shotCounts[player.side] = (state.shotCounts[player.side] ?? 0) + 1;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private applyBellHit(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as BellClashSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;
    if (state.roundScores[player.side] !== null) return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    const points = Math.max(0, Math.min(10_000, Math.floor(Number(payload.points))));
    if (roundNumber !== state.roundNumber || !Number.isFinite(points)) return null;
    if ((state.shotCounts[player.side] ?? 0) <= 0) return null;

    state.liveRoundScores[player.side] = (state.liveRoundScores[player.side] ?? 0) + points;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private applyRoundScore(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as BellClashSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    if (roundNumber !== state.roundNumber) return null;
    if ((state.shotCounts[player.side] ?? 0) < state.shotsPerRound) return null;
    if (state.roundScores[player.side] !== null) return null;

    state.roundScores[player.side] = state.liveRoundScores[player.side] ?? 0;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);

    if (state.roundScores.some((value) => value === null)) return room;

    for (let side = 0; side < state.roundScores.length; side++) {
      state.score[side] += state.roundScores[side] ?? 0;
    }

    if (state.roundNumber >= state.totalRounds) {
      room.status = 'finished';
      state.phase = 'finished';
      state.winnerSide = this.getWinnerSide(state.score);
      state.seq = ++room.seq;
      this.refreshSnapshotPlayers(room);
      return room;
    }

    state.roundNumber += 1;
    this.resetRound(state, room.players.length);
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private resetRound(state: BellClashSnapshot, playerCount: number): void {
    state.liveRoundScores = Array.from({ length: playerCount }, () => 0);
    state.roundScores = Array.from({ length: playerCount }, () => null);
    state.shotCounts = Array.from({ length: playerCount }, () => 0);
    state.zones = this.generateZones();
  }

  private generateZones(): BellClashSnapshot['zones'] {
    const kinds = this.shuffle<BellZoneKind>(['red', 'yellow', 'green']);
    const zones: BellClashSnapshot['zones'] = [];

    for (const kind of kinds) {
      let placed = false;
      for (let attempt = 0; attempt < 500 && !placed; attempt++) {
        const start = Math.random() * TWO_PI;
        const candidate = { kind, start, end: start + ZONE_SPAN };
        if (!zones.some((zone) => this.zonesOverlap(candidate, zone))) {
          zones.push(candidate);
          placed = true;
        }
      }
      for (let i = 0; i < 180 && !placed; i++) {
        const start = i * (Math.PI / 90);
        const candidate = { kind, start, end: start + ZONE_SPAN };
        if (!zones.some((zone) => this.zonesOverlap(candidate, zone))) {
          zones.push(candidate);
          placed = true;
        }
      }
    }

    return zones;
  }

  private zonesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
    const aParts = this.unwrapInterval(a.start, a.end);
    const bParts = this.unwrapInterval(b.start, b.end);
    return aParts.some((pa) => bParts.some((pb) => pa.start < pb.end && pb.start < pa.end));
  }

  private unwrapInterval(start: number, end: number): Array<{ start: number; end: number }> {
    const s = this.normalizeAngle(start);
    const e = this.normalizeAngle(end);
    if (end - start >= TWO_PI) return [{ start: 0, end: TWO_PI }];
    if (s < e) return [{ start: s, end: e }];
    return [{ start: s, end: TWO_PI }, { start: 0, end: e }];
  }

  private normalizeAngle(angle: number): number {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  }

  private shuffle<T>(values: T[]): T[] {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }

  private refreshSnapshotPlayers(room: MatchRoom): void {
    const state = room.state as BellClashSnapshot;
    state.players = room.players.map((player) => this.toSnapshotPlayer(player));
    state.seq = room.seq;
  }

  private toSnapshotPlayer(player: RoomPlayer): SnapshotPlayer {
    return {
      side: player.side,
      userId: player.user.id,
      username: player.user.username,
      connected: player.connected,
      ready: player.ready,
    };
  }

  private getWinnerSide(score: number[]): number | null {
    const maxScore = Math.max(...score);
    const winners = score.map((value, side) => ({ value, side })).filter((entry) => entry.value === maxScore);
    return winners.length === 1 ? winners[0].side : null;
  }
}
