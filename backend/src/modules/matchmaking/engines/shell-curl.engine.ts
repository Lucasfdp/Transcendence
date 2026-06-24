import { Injectable } from "@nestjs/common";
import { createGameMap } from "../game-map";
import {
	CurlingSnapshot,
	GameInputPayload,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import { BaseEngine } from "./base.engine";
import { GameEngine, GameEngineCreateContext } from "./game-engine";

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
			phase: "pending",
			currentTurn: 0,
			turnNumber: 0,
			maxTurns: playerCount * STONES_PER_PLAYER * TOTAL_ENDS,
			currentEnd: 0,
			throwsInEnd: 0,
			stonesPerPlayer: STONES_PER_PLAYER,
			totalEnds: TOTAL_ENDS,
			score: Array.from({ length: playerCount }, () => 0),
			map: createGameMap(context.gameId),
			players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
			objects: [],
			winnerSide: null,
		};
	}

	start(room: MatchRoom): void {
		room.status = "active";
		room.state.phase = "active";
		room.state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
	}

	handleInput(
		room: MatchRoom,
		userId: number,
		input: GameInputPayload,
	): MatchRoom | null {
		if (input.action === "release")
			return this.applyRelease(room, userId, input.payload ?? {});
		if (input.action === "settled")
			return this.applySettled(room, userId, input.payload ?? {});
		return room;
	}

	abandon(_room: MatchRoom, abandonedPlayer: RoomPlayer): number | null {
		return abandonedPlayer.side === 0 ? 1 : 0;
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
		if (state.objects.some((object) => object.id === state.turnNumber))
			return null;

		state.objects.push({
			id: state.turnNumber,
			side: player.side,
			x: 0,
			y: 0.5,
			power: String(payload.power ?? "none"),
		});
		state.seq = ++room.seq;
		this.refreshSnapshotPlayers(room);
		return room;
	}

	private applySettled(
		room: MatchRoom,
		userId: number,
		payload: Record<string, unknown> = {},
	): MatchRoom | null {
		const state = room.state as CurlingSnapshot;
		const player = room.players.find((p) => p.user.id === userId);
		if (!player || room.status !== "active") return null;
		if (player.side !== state.currentTurn) return null;

		const objects = Array.isArray(payload.objects) ? payload.objects : null;
		if (!objects) return null;

		state.objects = objects
			.map((object): SettledObject | null => {
				if (!object || typeof object !== "object") return null;
				const raw = object as Record<string, unknown>;
				const id = Number(raw.id);
				const side = Number(raw.side);
				const x = Number(raw.x);
				const y = Number(raw.y);
				if (
					!Number.isFinite(id) ||
					!Number.isFinite(side) ||
					!Number.isFinite(x) ||
					!Number.isFinite(y)
				)
					return null;
				return {
					id,
					side,
					x: Math.max(0, Math.min(1, x)),
					y: Math.max(0, Math.min(1, y)),
					power: String(raw.power ?? "none"),
					trail: Array.isArray(raw.trail)
						? (raw.trail as Array<{ x: number; y: number }>)
						: undefined,
				};
			})
			.filter((object): object is SettledObject => object !== null);

		state.turnNumber += 1;
		state.throwsInEnd += 1;

		if (state.throwsInEnd >= room.players.length * state.stonesPerPlayer) {
			const endScore = this.scoreEnd(state.objects);
			if (endScore.scoringSide !== null)
				state.score[endScore.scoringSide] += endScore.points;
			state.currentEnd += 1;
			state.throwsInEnd = 0;
			state.objects = [];
		}

		state.currentTurn = this.nextTurn(room);
		state.seq = ++room.seq;

		if (
			state.currentEnd >= state.totalEnds ||
			state.turnNumber >= state.maxTurns
		) {
			this.finish(room, this.getWinnerSide(state.score));
		}

		return room;
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

	private scoreEnd(objects: SettledObject[]): {
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
		const winners = score
			.map((value, side) => ({ value, side }))
			.filter((entry) => entry.value === maxScore);
		return winners.length === 1 ? winners[0].side : null;
	}

}
