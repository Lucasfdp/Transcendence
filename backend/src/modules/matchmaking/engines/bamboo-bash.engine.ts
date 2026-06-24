import { Injectable } from "@nestjs/common";
import {
	BambooBashSnapshot,
	GameInputPayload,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import { BaseEngine } from "./base.engine";
import { GameEngine, GameEngineCreateContext } from "./game-engine";

const TOTAL_ROUNDS = 3;
const ROUND_TIME_MS = 30_000;
const SPAWN_EVERY_MS = 1800;
const MAX_BAMBOO = 6;
const START_BAMBOO = 2;
const GROW_INTERVAL_MS = 5000;
const MAX_STAGE = 3;
const STAGE_POINTS: Record<number, number> = { 1: 100, 2: 150, 3: 250 };

@Injectable()
export class BambooBashEngine extends BaseEngine implements GameEngine {
	readonly gameId = "bamboo-bash";

	createInitialState(
		context: GameEngineCreateContext,
		roomPlayers: RoomPlayer[],
	): BambooBashSnapshot {
		return {
			matchId: context.matchId,
			seq: 0,
			gameId: "bamboo-bash",
			mode: context.mode,
			phase: "pending",
			roundNumber: 1,
			totalRounds: TOTAL_ROUNDS,
			roundTimeMs: ROUND_TIME_MS,
			roundStartedAt: null,
			roundEndsAt: null,
			score: Array.from({ length: roomPlayers.length }, () => 0),
			liveRoundScores: Array.from(
				{ length: roomPlayers.length },
				() => 0,
			),
			roundScores: Array.from({ length: roomPlayers.length }, () => null),
			bamboos: [],
			nextBambooId: 1,
			spawnAccMs: 0,
			lastBambooUpdateAt: null,
			players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
			winnerSide: null,
		};
	}

	start(room: MatchRoom): void {
		const state = room.state as BambooBashSnapshot;
		this.startRoundClock(state);
		this.resetSharedBamboos(state, room.players.length);
		room.status = "active";
		state.phase = "active";
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
	}

	handleInput(
		room: MatchRoom,
		userId: number,
		input: GameInputPayload,
	): MatchRoom | null {
		if (input.action === "release")
			return this.applyRelease(room, userId, input.payload ?? {});
		if (input.action === "bamboo:hit")
			return this.applyBambooHit(room, userId, input.payload ?? {});
		if (input.action === "bamboo:sync")
			return this.applyBambooSync(room, userId);
		if (input.action !== "round:score") return room;
		const state = room.state as BambooBashSnapshot;
		this.updateSharedBamboos(state);
		const player = room.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (!player || room.status !== "active") return null;

		const roundNumber = Math.floor(Number(input.payload?.roundNumber));
		const score = Math.floor(Number(input.payload?.score));
		if (roundNumber !== state.roundNumber) return null;
		if (!Number.isFinite(score) || score < 0) return null;
		if (state.roundScores[player.side] !== null) return null;

		state.roundScores[player.side] =
			state.liveRoundScores[player.side] ?? 0;
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);

		if (state.roundScores.some((value) => value === null)) return room;

		for (let side = 0; side < state.roundScores.length; side++) {
			state.score[side] += state.roundScores[side] ?? 0;
		}

		if (state.roundNumber >= state.totalRounds) {
			room.status = "finished";
			state.phase = "finished";
			state.winnerSide = this.getWinnerSide(state.score);
			state.seq = ++room.seq;
			this.refreshSnapshotPlayers(room);
			return room;
		}

		state.roundNumber += 1;
		state.liveRoundScores = Array.from(
			{ length: room.players.length },
			() => 0,
		);
		state.roundScores = Array.from(
			{ length: room.players.length },
			() => null,
		);
		this.startRoundClock(state);
		this.resetSharedBamboos(state, room.players.length);
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
		return room;
	}

	private applyRelease(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown> = {},
	): MatchRoom | null {
		const state = room.state as BambooBashSnapshot;
		this.updateSharedBamboos(state);
		const player = room.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (state.roundScores[player.side] !== null) return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const vx = Number(payload.vx);
		const vy = Number(payload.vy);
		if (roundNumber !== state.roundNumber) return null;
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
		return room;
	}

	private applyBambooHit(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown> = {},
	): MatchRoom | null {
		const state = room.state as BambooBashSnapshot;
		this.updateSharedBamboos(state);
		const player = room.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (state.roundScores[player.side] !== null) return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const bambooId = Math.floor(Number(payload.bambooId));
		if (roundNumber !== state.roundNumber || !Number.isFinite(bambooId))
			return null;

		const index = state.bamboos.findIndex(
			(bamboo) => bamboo.id === bambooId,
		);
		if (index < 0) return room;

		const [bamboo] = state.bamboos.splice(index, 1);
		const points = STAGE_POINTS[bamboo.stage] ?? 0;
		state.liveRoundScores[player.side] =
			(state.liveRoundScores[player.side] ?? 0) + points;
		this.spawnUpToLimit(state);
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
		return room;
	}

	private applyBambooSync(room: MatchRoom, userId: number): MatchRoom | null {
		const state = room.state as BambooBashSnapshot;
		const player = room.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (state.roundScores[player.side] !== null) return null;
		this.updateSharedBamboos(state);
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
		return room;
	}

	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
		const state = room.state as BambooBashSnapshot;
		const connectedScores = room.players
			.filter(
				(player) =>
					player.side !== abandonedPlayer.side && player.connected,
			)
			.map((player) => ({
				side: player.side,
				score: state.score[player.side] ?? 0,
			}));
		if (!connectedScores.length) return null;
		const maxScore = Math.max(
			...connectedScores.map((entry) => entry.score),
		);
		const winners = connectedScores.filter(
			(entry) => entry.score === maxScore,
		);
		return winners.length === 1 ? winners[0].side : null;
	}

	private startRoundClock(state: BambooBashSnapshot): void {
		state.roundStartedAt = Date.now();
		state.roundEndsAt = state.roundStartedAt + state.roundTimeMs;
	}

	private resetSharedBamboos(
		state: BambooBashSnapshot,
		playerCount: number,
	): void {
		state.liveRoundScores = Array.from({ length: playerCount }, () => 0);
		state.bamboos = [];
		state.nextBambooId = 1;
		state.spawnAccMs = 0;
		state.lastBambooUpdateAt = Date.now();
		for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo(state);
	}

	private updateSharedBamboos(state: BambooBashSnapshot): void {
		if (!state.lastBambooUpdateAt || state.phase !== "active") return;
		const now = Date.now();
		const delta = Math.max(0, now - state.lastBambooUpdateAt);
		state.lastBambooUpdateAt = now;

		for (const bamboo of state.bamboos) {
			bamboo.ageMs += delta;
			bamboo.stage = Math.min(
				MAX_STAGE,
				1 + Math.floor(bamboo.ageMs / GROW_INTERVAL_MS),
			);
		}

		state.spawnAccMs += delta;
		while (state.spawnAccMs >= SPAWN_EVERY_MS) {
			state.spawnAccMs -= SPAWN_EVERY_MS;
			if (state.bamboos.length < MAX_BAMBOO) this.spawnBamboo(state);
		}
	}

	private spawnUpToLimit(state: BambooBashSnapshot): void {
		if (state.bamboos.length < START_BAMBOO) this.spawnBamboo(state);
	}

	private spawnBamboo(state: BambooBashSnapshot): void {
		const spot = this.randomSpot(state.bamboos);
		if (!spot) return;
		state.bamboos.push({
			id: state.nextBambooId++,
			nx: spot.nx,
			ny: spot.ny,
			stage: 1,
			ageMs: 0,
		});
	}

	private randomSpot(
		existing: BambooBashSnapshot["bamboos"],
	): { nx: number; ny: number } | null {
		const maxRadius = 0.82;
		const clearOfCentre = 0.22;
		const minSep = 0.24;

		for (let attempt = 0; attempt < 24; attempt++) {
			const r = Math.sqrt(Math.random()) * maxRadius;
			const t = Math.random() * Math.PI * 2;
			const nx = r * Math.cos(t);
			const ny = r * Math.sin(t);
			if (Math.hypot(nx, ny) < clearOfCentre) continue;
			if (
				existing.some(
					(candidate) =>
						Math.hypot(candidate.nx - nx, candidate.ny - ny) <
						minSep,
				)
			)
				continue;
			return { nx, ny };
		}
		return null;
	}

	private getWinnerSide(score: number[]): number | null {
		const maxScore = Math.max(...score);
		const winners = score
			.map((value, side) => ({ value, side }))
			.filter((entry) => entry.value === maxScore);
		return winners.length === 1 ? winners[0].side : null;
	}
}
