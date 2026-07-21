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

	/**
	 * A fresh match's starting seat for a turn-based engine (temple-curling,
	 * kame-knock): picked once at `createInitialState` and stored on the
	 * snapshot as `startingTurn`, which every later turn rotation offsets by
	 * — so a match's play order is a random ROTATION of the seats (e.g.
	 * 2,3,0,1) instead of always 0,1,2,3, without touching `side` itself
	 * (side stays the player's stable colour/identity everywhere else: the
	 * scoreboard, trails, replays). Not part of the deterministic Tournament
	 * seed (SPEC-000/028) — this is the matchmaking/arena layer, which
	 * already uses plain randomness elsewhere (e.g. BotPlayerService).
	 */
	protected randomStartingTurn(playerCount: number): number {
		return Math.floor(Math.random() * Math.max(1, playerCount));
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
		// Include every non-abandoning seat, even one currently inside its 45s
		// reconnect window (P5). A temporarily disconnected leader is still a
		// participant: excluding them could hand the win to a trailing connected
		// seat. Only the abandoning side is dropped.
		const remaining = room.players
			.filter((player) => player.side !== abandonedPlayer.side)
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
