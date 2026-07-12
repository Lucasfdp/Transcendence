import { RoomPlayer, SnapshotPlayer } from "./matchmaking.types";

/**
 * Map a room player onto the snapshot representation sent to clients.
 *
 * Single source of truth for the mapping (and its cosmetic defaults) — it used
 * to be duplicated verbatim between RoomService.refreshSnapshotPlayers and
 * BaseEngine.toSnapshotPlayer, so a new field added in one copy silently went
 * missing from the other.
 */
export function toSnapshotPlayer(player: RoomPlayer): SnapshotPlayer {
	return {
		side: player.side,
		userId: player.user.id,
		username: player.user.username,
		turtleName: player.user.turtleName ?? null,
		shellSkin: player.user.shellSkin ?? "base",
		trailEffect: player.user.trailEffect ?? "trail_classic",
		hubBackground: player.user.hubBackground ?? "night_bg",
		hubBackgroundAlter: player.user.hubBackgroundAlter ?? null,
		connected: player.connected,
		ready: player.ready,
		reconnectExpiresAt: player.reconnectExpiresAt ?? null,
	};
}
