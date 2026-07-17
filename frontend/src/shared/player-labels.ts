import type { SnapshotPlayer } from "../services/network/gameSocket";

export interface PlayerLabelUser {
	username?: string;
	turtleName?: string | null;
}

const GENERATED_GUEST_USERNAME = /^guest_([0-9a-f]{12})$/i;

export function displayUsername(username: string | null | undefined): string {
	if (!username) return "";
	const guestMatch = GENERATED_GUEST_USERNAME.exec(username);
	return guestMatch ? `guest_${guestMatch[1].slice(0, 4)}` : username;
}

export function accountDisplayName(
	user: PlayerLabelUser | null | undefined,
	fallback = "Player",
): string {
	return user?.turtleName?.trim() || displayUsername(user?.username) || fallback;
}

export function playerDisplayName(
	player: Pick<SnapshotPlayer, "username"> & { turtleName?: string | null },
): string {
	return compactHudName(accountDisplayName(player));
}

export function localPlayerDisplayName(
	user: PlayerLabelUser | undefined,
	player: number,
): string {
	if (player === 0)
		return compactHudName(accountDisplayName(user, "Player 1"));
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
