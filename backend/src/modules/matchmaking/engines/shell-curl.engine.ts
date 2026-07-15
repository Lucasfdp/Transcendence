import { Injectable } from "@nestjs/common";
import { createShellCurlMap } from "../game-map";
import {
	CurlingSnapshot,
	GameInputPayload,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import {
	advanceShellCurlPhysics,
	createShellCurlPhysicsState,
	launchShellCurlProjectile,
	resetShellCurlPhysicsEnd,
	syncShellCurlSnapshot,
} from "../shell-curl-physics";
import { BaseEngine } from "./base.engine";
import { GameEngine, GameEngineCreateContext } from "./game-engine";

const TOTAL_ENDS = 3;
const BALLS_PER_PLAYER = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

const HOUSE_CX = (1570 - 380) / 1570;
const HOUSE_CY = 0.5;
const HOUSE_R_SRC = 220;
const SHEET_W_SRC = 1570;
const SHEET_H_SRC = 880;

const MAX_LAUNCH_SPEED = 5_000;
const ACTIVE_POWERS = new Set([
	"heavy", "splitter", "spinning", "rocket", "giant", "tiny", "mirror",
	"phantom",
]);

@Injectable()
export class ShellCurlEngine extends BaseEngine implements GameEngine {
	readonly gameId = "temple-curling";

	createInitialState(
		context: GameEngineCreateContext,
		roomPlayers: RoomPlayer[],
	): CurlingSnapshot {
		const playerCount = Math.max(
			MIN_PLAYERS,
			Math.min(MAX_PLAYERS, roomPlayers.length),
		);
		return {
			matchId: context.matchId,
			seq: 0,
			gameId: context.gameId,
			mode: context.mode,
			powerupsEnabled: context.powerupsEnabled ?? false,
			phase: "pending",
			currentTurn: 0,
			turnNumber: 0,
			maxTurns: playerCount * BALLS_PER_PLAYER * TOTAL_ENDS,
			currentEnd: 0,
			throwsInEnd: 0,
			ballsPerPlayer: BALLS_PER_PLAYER,
			totalEnds: TOTAL_ENDS,
			score: Array.from({ length: playerCount }, () => 0),
			endScores: Array.from({ length: TOTAL_ENDS }, () =>
				Array.from({ length: playerCount }, () => null),
			),
			usedPowersBySide: Array.from({ length: playerCount }, () => []),
			map: createShellCurlMap(),
			players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
			objects: [],
			entities: [],
			activeBallId: null,
			winnerSide: null,
		};
	}

	start(room: MatchRoom): void {
		room.status = "active";
		room.state.phase = "active";
		room.state.seq = ++room.seq;
		room.physicsState = createShellCurlPhysicsState(room.matchId);
		this.refreshSnapshotPlayers(room);
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
			room.state.gameId !== "temple-curling" ||
			!room.physicsState
		)
			return false;
		const state = room.state as CurlingSnapshot;
		const physics = room.physicsState as ReturnType<typeof createShellCurlPhysicsState>;
		if (!advanceShellCurlPhysics(physics, state, deltaMs)) return false;
		syncShellCurlSnapshot(state, physics);
		if (physics.entities.some((entity) => !entity.stopped)) {
			this.bumpRoomState(room);
			return true;
		}
		this.completeTurn(room, state, physics);
		return true;
	}

	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
		const state = room.state as CurlingSnapshot;
		return this.resolveAbandonWinner(room, abandonedPlayer, state.score);
	}

	private applyRelease(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown> = {},
	): MatchRoom | null {
		const state = room.state as CurlingSnapshot;
		const player = room.players.find((p) => p.user.id === userId);
		if (!player || room.status !== "active") return null;
		if (player.side !== state.currentTurn) return null;
		if (room.physicsState?.entities.some((entity) => !entity.stopped))
			return null;
		const vx = Number(payload.vx);
		const vy = Number(payload.vy);
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
		if (Math.hypot(vx, vy) > MAX_LAUNCH_SPEED) return null;
		const power = this.consumePower(state, player, payload.power);
		const physics = (room.physicsState ?? createShellCurlPhysicsState(room.matchId)) as ReturnType<typeof createShellCurlPhysicsState>;
		room.physicsState = physics;
		launchShellCurlProjectile(physics, player.side, vx, vy, power);
		syncShellCurlSnapshot(state, physics);
		this.bumpRoomState(room);
		return room;
	}

	private completeTurn(
		room: MatchRoom,
		state: CurlingSnapshot,
		physics: ReturnType<typeof createShellCurlPhysicsState>,
	): void {
		state.turnNumber += 1;
		state.throwsInEnd += 1;

		if (state.throwsInEnd >= room.players.length * state.ballsPerPlayer) {
			const endScore = this.scoreEnd(state.objects);
			const endScores = Array.from(
				{ length: state.score.length },
				() => 0,
			);
			if (endScore.scoringSide !== null) {
				state.score[endScore.scoringSide] += endScore.points;
				endScores[endScore.scoringSide] = endScore.points;
			}
			state.endScores[state.currentEnd] = endScores;
			state.currentEnd += 1;
			state.throwsInEnd = 0;
			resetShellCurlPhysicsEnd(physics);
			syncShellCurlSnapshot(state, physics);
			if (state.currentEnd < state.totalEnds) state.map = createShellCurlMap();
		}

		state.currentTurn = this.nextTurn(room);
		this.bumpRoomState(room);

		if (
			state.currentEnd >= state.totalEnds ||
			state.turnNumber >= state.maxTurns
		) {
			this.finish(room, this.getWinnerSide(state.score));
		}

	}

	private finish(
		room: MatchRoom,
		winnerSide: number | null,
		abandoned = false,
	): void {
		room.status = abandoned ? "abandoned" : "finished";
		room.state.phase = abandoned ? "abandoned" : "finished";
		room.state.winnerSide = winnerSide;
		room.state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
	}

	private nextTurn(room: MatchRoom): number {
		const state = room.state as CurlingSnapshot;
		if (state.throwsInEnd === 0) return 0;
		return (state.currentTurn + 1) % room.players.length;
	}

	private consumePower(
		state: CurlingSnapshot,
		player: RoomPlayer,
		value: unknown,
	): string {
		if (!state.powerupsEnabled) return "none";
		const power = String(value ?? "none");
		if (!ACTIVE_POWERS.has(power) || !player.shellSelection.includes(power))
			return "none";
		const usedPowers = (state.usedPowersBySide ??= Array.from(
			{ length: state.score.length },
			() => [],
		));
		usedPowers[player.side] ??= [];
		if (usedPowers[player.side].includes(power)) return "none";
		usedPowers[player.side].push(power);
		return power;
	}

	private bumpRoomState(room: MatchRoom): void {
		room.seq += 1;
		this.refreshSnapshotPlayers(room);
	}

	private scoreEnd(objects: CurlingSnapshot["objects"]): {
		scoringSide: number | null;
		points: number;
	} {
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
		const points = inHouse.filter(
			(object) =>
				object.side === scoringSide &&
				this.distanceToButton(object) < opponentDist,
		).length;
		return { scoringSide, points };
	}

	private isInHouse(object: CurlingSnapshot["objects"][number]): boolean {
		return this.distanceToButton(object) <= HOUSE_R_SRC;
	}

	private distanceToButton(object: CurlingSnapshot["objects"][number]): number {
		const dx = (object.x - HOUSE_CX) * SHEET_W_SRC;
		const dy = (object.y - HOUSE_CY) * SHEET_H_SRC;
		return Math.hypot(dx, dy);
	}
}
