import {
	BallSnapshotData,
	BambooBashSnapshot,
	BellClashSnapshot,
	KameKnockSnapshot,
	MatchRoom,
	ReplayFrameSnapshotEntity,
	RoomPlayer,
	SnapshotPlayer,
} from "../matchmaking.types";
import { resetArenaReplayBalls } from "../replay-state.helpers";
import { BaseEngine } from "./base.engine";

type ArenaReplaySnapshot =
	| BambooBashSnapshot
	| KameKnockSnapshot
	| BellClashSnapshot;

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

	protected getWinnerSide(score: number[]): number | null {
		const maxScore = Math.max(...score);
		const winners = score
			.map((value, side) => ({ value, side }))
			.filter((entry) => entry.value === maxScore);
		return winners.length === 1 ? winners[0].side : null;
	}

	protected resolveAbandonWinner(
		room: MatchRoom,
		abandonedPlayer: RoomPlayer,
		score: number[],
	): number | null {
		const remaining = room.players
			.filter(
				(player) =>
					player.side !== abandonedPlayer.side && player.connected,
			)
			.map((player) => ({
				side: player.side,
				score: score[player.side] ?? 0,
			}));
		if (!remaining.length) return null;
		const maxScore = Math.max(...remaining.map((entry) => entry.score));
		const winners = remaining.filter((entry) => entry.score === maxScore);
		return winners.length === 1 ? winners[0].side : null;
	}
}
