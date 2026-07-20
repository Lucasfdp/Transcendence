import { Injectable } from "@nestjs/common";
import {
	BellClashSnapshot,
	GameInputPayload,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import {
	resetArenaReplayBalls,
} from "../replay-state.helpers";
import {
	advanceBellPhysics,
	createBellPhysicsState,
	ensureBellPhysicsPickup,
	launchBellProjectile,
	resetBellPhysicsRound,
} from "../bell-clash-physics";
import { BaseArenaEngine } from "./base-arena.engine";
import { GameEngine, GameEngineCreateContext } from "./game-engine";

type BellZoneKind = "red" | "yellow" | "green";

const TOTAL_ROUNDS = 3;
const SHOTS_PER_ROUND = 3;
const ZONE_SPAN = Math.PI * 2 * 0.15;
const TWO_PI = Math.PI * 2;

@Injectable()
export class BellClashEngine extends BaseArenaEngine implements GameEngine {
	readonly gameId = "bell-clash";
	readonly minPlayers = 2;
	readonly maxPlayers = 5;

	createInitialState(
		context: GameEngineCreateContext,
		roomPlayers: RoomPlayer[],
	): BellClashSnapshot {
		return {
			matchId: context.matchId,
			seq: 0,
			gameId: "bell-clash",
			mode: context.mode,
			powerupsEnabled: context.powerupsEnabled ?? false,
			phase: "pending",
			roundNumber: 1,
			totalRounds: TOTAL_ROUNDS,
			shotsPerRound: SHOTS_PER_ROUND,
			score: Array.from({ length: roomPlayers.length }, () => 0),
			liveRoundScores: Array.from(
				{ length: roomPlayers.length },
				() => 0,
			),
			roundScores: Array.from({ length: roomPlayers.length }, () => null),
			shotCounts: Array.from({ length: roomPlayers.length }, () => 0),
			usedPowersBySide: Array.from(
				{ length: roomPlayers.length },
				() => [],
			),
			zones: [],
			...this.buildArenaReplayState(roomPlayers),
		};
	}

	start(room: MatchRoom): void {
		const state = room.state as BellClashSnapshot;
		this.startArenaRoom(room, state, (snapshot) => {
			this.resetRound(snapshot, room.players.length);
		});
		room.physicsState = createBellPhysicsState(room.matchId);
		resetBellPhysicsRound(room.physicsState, state.powerupsEnabled);
	}

	handleInput(
		room: MatchRoom,
		userId: number,
		input: GameInputPayload,
	): MatchRoom | null {
		if (input.action === "release")
			return this.applyRelease(room, userId, input.payload ?? {});
		return null;
	}

	advanceSimulation(room: MatchRoom, deltaMs: number): boolean {
		if (
			room.status !== "active" ||
			!room.physicsState ||
			room.state.gameId !== "bell-clash"
		)
			return false;
		const state = room.state as BellClashSnapshot;
		const result = advanceBellPhysics(
			room.physicsState as ReturnType<typeof createBellPhysicsState>,
			state,
			deltaMs,
		);
		if (!result.changed) return false;
		this.syncPhysicsEntities(state, room);
		if (result.scoreChanged) this.bumpRoomState(room);
		this.tryCompleteRound(room, state);
		return true;
	}

	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
		const state = room.state as BellClashSnapshot;
		return this.resolveAbandonWinner(room, abandonedPlayer, state.score);
	}

	private applyRelease(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown>,
	): MatchRoom | null {
		const state = room.state as BellClashSnapshot;
		const player = this.findRoomPlayer(room, userId);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (state.roundScores[player.side] !== null) return null;
		if ((state.shotCounts[player.side] ?? 0) >= state.shotsPerRound)
			return null;
		if (
			room.physicsState?.entities.some(
				(entity) => entity.ownerSide === player.side && !entity.stopped,
			)
		)
			return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const vx = Number(payload.vx);
		const vy = Number(payload.vy);
		if (roundNumber !== state.roundNumber) return null;
		if (
			!Number.isFinite(vx) ||
			!Number.isFinite(vy)
		)
			return null;
		if (
			Math.hypot(vx, vy) > 5_000
		)
			return null;

		state.shotCounts[player.side] =
			(state.shotCounts[player.side] ?? 0) + 1;
		const power = this.consumeArenaPower(state, player, payload.power);
		room.physicsState ??= createBellPhysicsState(room.matchId);
		const previous = room.physicsState.entities.find(
			(entity) => entity.ownerSide === player.side && entity.primary,
		);
		const spawnAngle =
			-Math.PI / 2 +
			(player.side / Math.max(1, room.players.length)) * Math.PI * 2;
		const origin = previous
			? { x: previous.x, y: previous.y }
			: { x: Math.cos(spawnAngle) * 320, y: Math.sin(spawnAngle) * 320 };
		ensureBellPhysicsPickup(
			room.physicsState as ReturnType<typeof createBellPhysicsState>,
			state.powerupsEnabled,
		);
		launchBellProjectile(
			room.physicsState as ReturnType<typeof createBellPhysicsState>,
			player.side,
			state.shotCounts[player.side],
			origin.x,
			origin.y,
			vx,
			vy,
			power,
		);
		this.syncPhysicsEntities(state, room);
		this.bumpRoomState(room);
		return room;
	}

	private tryCompleteRound(
		room: MatchRoom,
		state: BellClashSnapshot,
	): void {
		if (
			state.shotCounts.some((count) => count < state.shotsPerRound) ||
			room.physicsState?.entities.some((entity) => !entity.stopped)
		)
			return;
		state.roundScores = state.liveRoundScores.map((score) => score ?? 0);
		this.bumpRoomState(room);
		for (let side = 0; side < state.roundScores.length; side++) {
			state.score[side] += state.roundScores[side] ?? 0;
		}

		if (state.roundNumber >= state.totalRounds) {
			room.status = "finished";
			state.phase = "finished";
			state.winnerSide = this.getWinnerSide(state.score);
			this.bumpRoomState(room);
			return;
		}

		state.roundNumber += 1;
		this.resetRound(state, room.players.length);
		resetArenaReplayBalls(state, { clearEntities: true });
		if (room.physicsState)
			resetBellPhysicsRound(
				room.physicsState as ReturnType<typeof createBellPhysicsState>,
				state.powerupsEnabled,
			);
		this.bumpRoomState(room);
	}

	private syncPhysicsEntities(
		state: BellClashSnapshot,
		room: MatchRoom,
	): void {
		const physics = room.physicsState as ReturnType<typeof createBellPhysicsState> | undefined;
		if (!physics) return;
		state.entities = physics.entities.map((entity) => ({
			id: entity.id,
			type: "projectile",
			side: entity.ownerSide,
			ownerSide: entity.ownerSide,
			x: entity.x / 705,
			y: entity.y / 491,
			vx: entity.vx,
			vy: entity.vy,
			rotation: entity.rotation,
			angularVelocity: entity.angularVelocity,
			r: entity.radius,
			power: entity.power,
			scale: entity.radius / 52,
			visible: true,
			alpha: entity.alpha,
			spriteKey: "bell-clash-shell",
			stateFlags: [entity.stopped ? "settled" : "sliding"],
			createdAt: physics.serverTime,
			updatedAt: physics.serverTime,
			stopped: entity.stopped,
		}));
		state.balls = state.players
			.map((player) =>
				state.entities.find(
					(entity) =>
						entity.ownerSide === player.side &&
						physics.entities.find(
							(candidate) => candidate.id === entity.id,
						)?.primary,
				),
			)
			.filter((entity): entity is BellClashSnapshot["balls"][number] =>
				Boolean(entity),
			);
		state.activeBallIdBySide = state.players.map(
			(player) =>
				physics.entities.find(
					(entity) => entity.ownerSide === player.side && entity.primary,
				)?.id ?? null,
		);
		state.nextBallId = physics.nextEntityId;
	}

	private resetRound(state: BellClashSnapshot, playerCount: number): void {
		state.liveRoundScores = Array.from({ length: playerCount }, () => 0);
		state.roundScores = Array.from({ length: playerCount }, () => null);
		state.shotCounts = Array.from({ length: playerCount }, () => 0);
		state.usedPowersBySide = Array.from({ length: playerCount }, () => []);
		state.zones = this.generateZones();
	}

	private generateZones(): BellClashSnapshot["zones"] {
		const kinds = this.shuffle<BellZoneKind>(["red", "yellow", "green"]);
		const zones: BellClashSnapshot["zones"] = [];

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

	private zonesOverlap(
		a: { start: number; end: number },
		b: { start: number; end: number },
	): boolean {
		const aParts = this.unwrapInterval(a.start, a.end);
		const bParts = this.unwrapInterval(b.start, b.end);
		return aParts.some((pa) =>
			bParts.some((pb) => pa.start < pb.end && pb.start < pa.end),
		);
	}

	private unwrapInterval(
		start: number,
		end: number,
	): Array<{ start: number; end: number }> {
		const s = this.normalizeAngle(start);
		const e = this.normalizeAngle(end);
		if (end - start >= TWO_PI) return [{ start: 0, end: TWO_PI }];
		if (s < e) return [{ start: s, end: e }];
		return [
			{ start: s, end: TWO_PI },
			{ start: 0, end: e },
		];
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

}
