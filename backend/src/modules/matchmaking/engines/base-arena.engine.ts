import {
	BambooBashSnapshot,
	BellClashSnapshot,
	KameKnockSnapshot,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";
import { resetArenaReplayBalls } from "../replay-state.helpers";
import { BaseEngine } from "./base.engine";

type ArenaReplaySnapshot =
	| BambooBashSnapshot
	| KameKnockSnapshot
	| BellClashSnapshot;

const ARENA_ALLOWED_POWERS = new Set([
	"none",
	"heavy",
	"splitter",
	"spinning",
	"rocket",
	"giant",
	"tiny",
	"mirror",
	"phantom",
]);

export abstract class BaseArenaEngine extends BaseEngine {
	protected buildArenaReplayState(
		roomPlayers: RoomPlayer[],
	): Pick<
		ArenaReplaySnapshot,
		"players" | "balls" | "activeBallIdBySide" | "nextBallId" | "entities" | "winnerSide"
	> {
		return {
			players: roomPlayers.map((player) => this.toSnapshotPlayer(player)),
			balls: [],
			activeBallIdBySide: [],
			nextBallId: 1,
			entities: [],
			winnerSide: null,
		};
	}

	protected startArenaRoom<T extends ArenaReplaySnapshot>(
		room: MatchRoom,
		state: T,
		setup: (state: T) => void,
	): void {
		room.status = "active";
		state.phase = "active";
		setup(state);
		resetArenaReplayBalls(state, { clearEntities: true });
		this.bumpRoomState(room);
	}

	protected bumpRoomState(room: MatchRoom): void {
		room.seq += 1;
		const state = room.state as { seq: number };
		state.seq = room.seq;
		this.refreshSnapshotPlayers(room);
	}

	protected findRoomPlayer(
		room: MatchRoom,
		userId: number,
	): RoomPlayer | undefined {
		return room.players.find((candidate) => candidate.user.id === userId);
	}

	protected consumeArenaPower(
		state: { powerupsEnabled: boolean; usedPowersBySide: string[][] },
		side: number,
		value: unknown,
	): string {
		if (!state.powerupsEnabled) return "none";
		const power = String(value ?? "none");
		if (power === "none" || !ARENA_ALLOWED_POWERS.has(power)) return "none";
		state.usedPowersBySide[side] ??= [];
		if (state.usedPowersBySide[side].includes(power)) return "none";
		state.usedPowersBySide[side].push(power);
		return power;
	}
}
