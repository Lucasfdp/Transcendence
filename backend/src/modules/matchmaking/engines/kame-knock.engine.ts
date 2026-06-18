import { Injectable } from '@nestjs/common';
import { GameInputPayload, KameKnockSnapshot, MatchRoom, RoomPlayer, SnapshotPlayer } from '../matchmaking.types';
import { GameEngine, GameEngineCreateContext } from './game-engine';

const ROUND_CONFIGS = [
  { totalTargets: 7, breakableTargets: 4 },
  { totalTargets: 10, breakableTargets: 6 },
  { totalTargets: 15, breakableTargets: 10 },
] as const;

const TARGET_TYPES = [
  { kind: 'daruma' as const, points: 100, radiusSrc: 30 },
  { kind: 'crate' as const, points: 120, radiusSrc: 28 },
  { kind: 'drum' as const, points: 150, radiusSrc: 32 },
] as const;

@Injectable()
export class KameKnockEngine implements GameEngine {
  readonly gameId = 'kame-knock';

  createInitialState(context: GameEngineCreateContext, roomPlayers: RoomPlayer[]): KameKnockSnapshot {
    return {
      matchId: context.matchId,
      seq: 0,
      gameId: 'kame-knock',
      mode: context.mode,
      phase: 'pending',
      currentTurn: 0,
      turnNumber: 0,
      roundNumber: 1,
      totalRounds: ROUND_CONFIGS.length,
      activeTurnNumber: null,
      score: Array.from({ length: roomPlayers.length }, () => 0),
      roundScores: Array.from({ length: roomPlayers.length }, () => 0),
      targets: [],
      nextTargetId: 1,
      players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
      winnerSide: null,
    };
  }

  start(room: MatchRoom): void {
    const state = room.state as KameKnockSnapshot;
    room.status = 'active';
    state.phase = 'active';
    this.resetRoundTargets(state, room.players.length);
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
  }

  handleInput(room: MatchRoom, userId: number, input: GameInputPayload): MatchRoom | null {
    if (input.action === 'release') return this.applyRelease(room, userId, input.payload ?? {});
    if (input.action === 'target:hit') return this.applyTargetHit(room, userId, input.payload ?? {});
    if (input.action === 'settled') return this.applySettled(room, userId, input.payload ?? {});
    return room;
  }

  abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
    const state = room.state as KameKnockSnapshot;
    const remaining = room.players
      .filter((player) => player.side !== abandonedPlayer.side && player.connected)
      .map((player) => ({ side: player.side, score: state.score[player.side] ?? 0 }));
    if (!remaining.length) return null;
    const maxScore = Math.max(...remaining.map((entry) => entry.score));
    const winners = remaining.filter((entry) => entry.score === maxScore);
    return winners.length === 1 ? winners[0].side : null;
  }

  private applyRelease(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as KameKnockSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;
    if (player.side !== state.currentTurn) return null;
    if (state.activeTurnNumber !== null) return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    const turnNumber = Math.floor(Number(payload.turnNumber));
    const vx = Number(payload.vx);
    const vy = Number(payload.vy);
    if (roundNumber !== state.roundNumber || turnNumber !== state.turnNumber) return null;
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;

    state.activeTurnNumber = state.turnNumber;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private applyTargetHit(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as KameKnockSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;
    if (player.side !== state.currentTurn) return null;
    if (state.activeTurnNumber !== state.turnNumber) return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    const turnNumber = Math.floor(Number(payload.turnNumber));
    const targetId = Math.floor(Number(payload.targetId));
    const combo = Math.max(1, Math.min(99, Math.floor(Number(payload.combo ?? 1))));
    const perfect = Boolean(payload.perfect);
    if (roundNumber !== state.roundNumber || turnNumber !== state.turnNumber || !Number.isFinite(targetId)) return null;

    const index = state.targets.findIndex((target) => target.id === targetId);
    if (index < 0) return room;
    const target = state.targets[index];
    if (!target.breakable) return room;

    state.targets.splice(index, 1);
    const gained = target.points * combo + (perfect ? 500 : 0);
    state.score[player.side] = (state.score[player.side] ?? 0) + gained;
    state.roundScores[player.side] = (state.roundScores[player.side] ?? 0) + gained;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private applySettled(room: MatchRoom, userId: number, payload: Record<string, unknown>): MatchRoom | null {
    const state = room.state as KameKnockSnapshot;
    const player = room.players.find((candidate) => candidate.user.id === userId);
    if (!player || room.status !== 'active' || state.phase !== 'active') return null;
    if (player.side !== state.currentTurn) return null;
    if (state.activeTurnNumber !== state.turnNumber) return null;

    const roundNumber = Math.floor(Number(payload.roundNumber));
    const turnNumber = Math.floor(Number(payload.turnNumber));
    if (roundNumber !== state.roundNumber || turnNumber !== state.turnNumber) return null;

    state.activeTurnNumber = null;
    state.turnNumber += 1;
    if (state.turnNumber >= room.players.length * state.totalRounds) {
      room.status = 'finished';
      state.phase = 'finished';
      state.winnerSide = this.getWinnerSide(state.score);
      state.seq = ++room.seq;
      this.refreshSnapshotPlayers(room);
      return room;
    }

    const nextRound = Math.floor(state.turnNumber / room.players.length) + 1;
    if (nextRound !== state.roundNumber) {
      state.roundNumber = nextRound;
      this.resetRoundTargets(state, room.players.length);
    }

    state.currentTurn = state.turnNumber % room.players.length;
    state.seq = ++room.seq;
    this.refreshSnapshotPlayers(room);
    return room;
  }

  private resetRoundTargets(state: KameKnockSnapshot, playerCount: number): void {
    const config = ROUND_CONFIGS[state.roundNumber - 1] ?? ROUND_CONFIGS[ROUND_CONFIGS.length - 1];
    const flags = this.shuffle(Array.from({ length: config.totalTargets }, (_value, index) => index < config.breakableTargets));
    state.roundScores = Array.from({ length: playerCount }, () => 0);
    state.targets = [];
    state.nextTargetId = 1;
    for (const breakable of flags) this.spawnTarget(state, breakable);
  }

  private spawnTarget(state: KameKnockSnapshot, breakable: boolean): void {
    const spot = this.randomSpot(state.targets) ?? this.fallbackSpot();
    const type = TARGET_TYPES[Math.floor(Math.random() * TARGET_TYPES.length)] ?? TARGET_TYPES[0];
    state.targets.push({
      id: state.nextTargetId++,
      kind: type.kind,
      breakable,
      nx: spot.nx,
      ny: spot.ny,
      ageMs: 0,
      lifetimeMs: Number.POSITIVE_INFINITY,
      radiusSrc: type.radiusSrc,
      points: type.points,
    });
  }

  private randomSpot(existing: KameKnockSnapshot['targets']): { nx: number; ny: number } | null {
    for (let attempt = 0; attempt < 32; attempt++) {
      const radius = Math.sqrt(Math.random()) * 0.78;
      const theta = Math.random() * Math.PI * 2;
      const nx = Math.cos(theta) * radius;
      const ny = Math.sin(theta) * radius;
      if (Math.hypot(nx, ny) < 0.24) continue;
      if (existing.some((target) => Math.hypot(target.nx - nx, target.ny - ny) < 0.15)) continue;
      return { nx, ny };
    }
    return null;
  }

  private fallbackSpot(): { nx: number; ny: number } {
    const radius = 0.28 + Math.random() * 0.56;
    const theta = Math.random() * Math.PI * 2;
    return { nx: Math.cos(theta) * radius, ny: Math.sin(theta) * radius };
  }

  private shuffle<T>(values: T[]): T[] {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }

  private refreshSnapshotPlayers(room: MatchRoom): void {
    const state = room.state as KameKnockSnapshot;
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
      reconnectExpiresAt: player.reconnectExpiresAt ?? null,
    };
  }

  private getWinnerSide(score: number[]): number | null {
    const maxScore = Math.max(...score);
    const winners = score.map((value, side) => ({ value, side })).filter((entry) => entry.value === maxScore);
    return winners.length === 1 ? winners[0].side : null;
  }
}
