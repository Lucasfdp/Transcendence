import type { SnapshotPlayer } from "../services/network/gameSocket";

export interface PlayerLabelUser {
	username?: string;
	turtleName?: string | null;
}

export function playerDisplayName(
	player: Pick<SnapshotPlayer, "username"> & { turtleName?: string | null },
): string {
	return compactHudName(player.turtleName?.trim() || player.username || "Player");
}

export function localPlayerDisplayName(
	user: PlayerLabelUser | undefined,
	player: number,
): string {
	if (player === 0)
		return compactHudName(
			user?.turtleName?.trim() || user?.username || "Player 1",
		);
	return `Player ${player + 1}`;
}

export function hudPlayerLabel(options: {
	player: number;
	localUser?: PlayerLabelUser;
	onlinePlayers?: readonly (Pick<SnapshotPlayer, "side" | "username"> & { turtleName?: string | null })[];
}): string {
	const onlinePlayer = options.onlinePlayers?.find(
		(candidate) => candidate.side === options.player,
	);
	if (onlinePlayer) return playerDisplayName(onlinePlayer);
	return localPlayerDisplayName(options.localUser, options.player);
}

function compactHudName(name: string): string {
	const limit = 16;
	return name.length <= limit ? name : `${name.slice(0, limit - 3)}...`;
}
