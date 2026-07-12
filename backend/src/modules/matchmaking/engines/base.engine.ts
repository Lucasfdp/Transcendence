import { MatchRoom, RoomPlayer, SnapshotPlayer } from "../matchmaking.types";
import { toSnapshotPlayer } from "../snapshot-player.util";

export abstract class BaseEngine {
	/**
	 * Syncs room.players back into the snapshot's players array and seq counter.
	 *
	 * The double-cast (`as unknown as`) is intentional: CurlingSnapshot uses a
	 * narrower player element type that omits `reconnectExpiresAt`, which makes
	 * a direct `room.state as { players: SnapshotPlayer[] }` assertion ambiguous
	 * to the compiler.  At runtime, assigning SnapshotPlayer objects to that
	 * field is safe — the extra property is simply present on the objects and
	 * ignored by consumers that do not expect it.
	 */
	protected refreshSnapshotPlayers(room: MatchRoom): void {
		const state = room.state as unknown as {
			players: SnapshotPlayer[];
			seq: number;
		};
		state.players = room.players.map((player) =>
			this.toSnapshotPlayer(player),
		);
		state.seq = room.seq;
	}

	protected toSnapshotPlayer(player: RoomPlayer): SnapshotPlayer {
		return toSnapshotPlayer(player);
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
