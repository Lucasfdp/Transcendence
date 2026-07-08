import { Injectable } from "@nestjs/common";
import {
	GameInputPayload,
	KameKnockSnapshot,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import {
	initializeArenaReplayBall,
	resetArenaReplayBalls,
	settleArenaReplayBall,
	syncArenaReplayBallFromPayload,
} from "../replay-state.helpers";
import { BaseArenaEngine } from "./base-arena.engine";
import { GameEngine, GameEngineCreateContext } from "./game-engine";

const ROUND_CONFIGS = [
	{ totalTargets: 7, breakableTargets: 4 },
	{ totalTargets: 10, breakableTargets: 6 },
	{ totalTargets: 15, breakableTargets: 10 },
] as const;

const TARGET_TYPES = [
	{ kind: "daruma" as const, points: 100, radiusSrc: 30 },
	{ kind: "crate" as const, points: 120, radiusSrc: 28 },
	{ kind: "drum" as const, points: 150, radiusSrc: 32 },
] as const;

type KameKnockTarget = KameKnockSnapshot["targets"][number];

@Injectable()
export class KameKnockEngine extends BaseArenaEngine implements GameEngine {
	readonly gameId = "kame-knock";
	private readonly roundTargetSets = new Map<string, KameKnockTarget[][]>();

	createInitialState(
		context: GameEngineCreateContext,
		roomPlayers: RoomPlayer[],
	): KameKnockSnapshot {
		return {
			matchId: context.matchId,
			seq: 0,
			gameId: "kame-knock",
			mode: context.mode,
			powerupsEnabled: context.powerupsEnabled ?? true,
			phase: "pending",
			currentTurn: 0,
			turnNumber: 0,
			roundNumber: 1,
			totalRounds: ROUND_CONFIGS.length,
			activeTurnNumber: null,
			score: Array.from({ length: roomPlayers.length }, () => 0),
			roundScores: Array.from({ length: roomPlayers.length }, () => 0),
			usedPowersBySide: Array.from(
				{ length: roomPlayers.length },
				() => [],
			),
			targets: [],
			nextTargetId: 1,
			...this.buildArenaReplayState(roomPlayers),
		};
	}

	start(room: MatchRoom): void {
		const state = room.state as KameKnockSnapshot;
		this.startArenaRoom(room, state, (snapshot) => {
			this.createRoundTargetSet(room.matchId, snapshot.roundNumber);
			this.resetTurnTargets(room.matchId, snapshot);
		});
	}

	handleInput(
		room: MatchRoom,
		userId: number,
		input: GameInputPayload,
	): MatchRoom | null {
		if (input.action === "release")
			return this.applyRelease(room, userId, input.payload ?? {});
		if (input.action === "target:hit")
			return this.applyTargetHit(room, userId, input.payload ?? {});
		if (input.action === "settled")
			return this.applySettled(room, userId, input.payload ?? {});
		return room;
	}

	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
		const state = room.state as KameKnockSnapshot;
		return this.resolveAbandonWinner(room, abandonedPlayer, state.score);
	}

	onRoomClosed(room: MatchRoom): void {
		this.roundTargetSets.delete(room.matchId);
	}

	private applyRelease(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown>,
	): MatchRoom | null {
		const state = room.state as KameKnockSnapshot;
		const player = this.findRoomPlayer(room, userId);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (player.side !== state.currentTurn) return null;
		if (state.activeTurnNumber !== null) return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const turnNumber = Math.floor(Number(payload.turnNumber));
		const vx = Number(payload.vx);
		const vy = Number(payload.vy);
		if (
			roundNumber !== state.roundNumber ||
			turnNumber !== state.turnNumber
		)
			return null;
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;

		state.activeTurnNumber = state.turnNumber;
		const power = this.consumeArenaPower(state, player.side, payload.power);
		initializeArenaReplayBall(
			state,
			player.side,
			vx,
			vy,
			undefined,
			power,
		);
		this.bumpRoomState(room);
		return room;
	}

	private applyTargetHit(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown>,
	): MatchRoom | null {
		const state = room.state as KameKnockSnapshot;
		const player = this.findRoomPlayer(room, userId);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (player.side !== state.currentTurn) return null;
		if (state.activeTurnNumber !== state.turnNumber) return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const turnNumber = Math.floor(Number(payload.turnNumber));
		const targetId = Math.floor(Number(payload.targetId));
		const combo = Math.max(
			1,
			Math.min(99, Math.floor(Number(payload.combo ?? 1))),
		);
		const perfect = Boolean(payload.perfect);
		if (
			roundNumber !== state.roundNumber ||
			turnNumber !== state.turnNumber ||
			!Number.isFinite(targetId)
		)
			return null;

		const index = state.targets.findIndex(
			(target) => target.id === targetId,
		);
		if (index < 0) return room;
		const target = state.targets[index];
		if (!target.breakable) return room;

		syncArenaReplayBallFromPayload(state, player.side, payload);
		state.targets.splice(index, 1);
		const gained = target.points * combo + (perfect ? 500 : 0);
		state.score[player.side] = (state.score[player.side] ?? 0) + gained;
		state.roundScores[player.side] =
			(state.roundScores[player.side] ?? 0) + gained;
		this.bumpRoomState(room);
		return room;
	}

	private applySettled(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown>,
	): MatchRoom | null {
		const state = room.state as KameKnockSnapshot;
		const player = this.findRoomPlayer(room, userId);
		if (!player || room.status !== "active" || state.phase !== "active")
			return null;
		if (player.side !== state.currentTurn) return null;
		if (state.activeTurnNumber !== state.turnNumber) return null;

		const roundNumber = Math.floor(Number(payload.roundNumber));
		const turnNumber = Math.floor(Number(payload.turnNumber));
		if (
			roundNumber !== state.roundNumber ||
			turnNumber !== state.turnNumber
		)
			return null;

		settleArenaReplayBall(state, player.side, payload);
		state.activeTurnNumber = null;
		state.turnNumber += 1;
		if (state.turnNumber >= room.players.length * state.totalRounds) {
			room.status = "finished";
			state.phase = "finished";
			state.winnerSide = this.getWinnerSide(state.score);
			this.roundTargetSets.delete(room.matchId);
			this.bumpRoomState(room);
			return room;
		}

		const nextRound =
			Math.floor(state.turnNumber / room.players.length) + 1;
		const isNewRound = nextRound !== state.roundNumber;
		if (isNewRound) {
			state.roundNumber = nextRound;
			state.roundScores = Array.from(
				{ length: room.players.length },
				() => 0,
			);
			state.usedPowersBySide = Array.from(
				{ length: room.players.length },
				() => [],
			);
			this.createRoundTargetSet(room.matchId, state.roundNumber);
		}

		state.currentTurn = state.turnNumber % room.players.length;
		this.resetTurnTargets(room.matchId, state);
		resetArenaReplayBalls(state, {
			clearEntities: isNewRound,
		});
		this.bumpRoomState(room);
		return room;
	}

	private createRoundTargetSet(matchId: string, roundNumber: number): void {
		const targetSets = this.roundTargetSets.get(matchId) ?? [];
		if (targetSets[roundNumber - 1]) return;
		const config =
			ROUND_CONFIGS[roundNumber - 1] ??
			ROUND_CONFIGS[ROUND_CONFIGS.length - 1];
		const flags = this.shuffle(
			Array.from(
				{ length: config.totalTargets },
				(_value, index) => index < config.breakableTargets,
			),
		);
		const targets: KameKnockTarget[] = [];
		for (const breakable of flags)
			this.spawnTarget(targets, targets.length + 1, breakable);
		targetSets[roundNumber - 1] = targets;
		this.roundTargetSets.set(matchId, targetSets);
	}

	private resetTurnTargets(matchId: string, state: KameKnockSnapshot): void {
		this.createRoundTargetSet(matchId, state.roundNumber);
		const targets =
			this.roundTargetSets.get(matchId)?.[state.roundNumber - 1] ?? [];
		state.targets = targets.map((target) => ({ ...target, ageMs: 0 }));
		state.nextTargetId = targets.length + 1;
	}

	private spawnTarget(
		targets: KameKnockTarget[],
		id: number,
		breakable: boolean,
	): void {
		const spot = this.randomSpot(targets) ?? this.fallbackSpot();
		const type =
			TARGET_TYPES[Math.floor(Math.random() * TARGET_TYPES.length)] ??
			TARGET_TYPES[0];
		targets.push({
			id,
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

	private randomSpot(
		existing: KameKnockSnapshot["targets"],
	): { nx: number; ny: number } | null {
		for (let attempt = 0; attempt < 32; attempt++) {
			const radius = Math.sqrt(Math.random()) * 0.78;
			const theta = Math.random() * Math.PI * 2;
			const nx = Math.cos(theta) * radius;
			const ny = Math.sin(theta) * radius;
			if (Math.hypot(nx, ny) < 0.24) continue;
			if (
				existing.some(
					(target) =>
						Math.hypot(target.nx - nx, target.ny - ny) < 0.15,
				)
			)
				continue;
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

}
