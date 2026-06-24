import { MatchRoom, RoomPlayer, SnapshotPlayer } from "../matchmaking.types";

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
		return {
			side: player.side,
			userId: player.user.id,
			username: player.user.username,
			connected: player.connected,
			ready: player.ready,
			reconnectExpiresAt: player.reconnectExpiresAt ?? null,
		};
	}
}
