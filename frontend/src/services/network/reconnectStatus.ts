import type { GameSnapshot } from "./gameSocket";

export function formatReconnectStatus(
	snapshot: GameSnapshot | null | undefined,
	localSide: number | null | undefined,
): string | null {
	if (
		!snapshot ||
		snapshot.phase === "finished" ||
		snapshot.phase === "abandoned"
	)
		return null;
	const player = snapshot.players.find(
		(candidate) => !candidate.connected && candidate.reconnectExpiresAt,
	);
	if (!player?.reconnectExpiresAt) return null;

	const remaining = Math.max(
		0,
		Math.ceil((player.reconnectExpiresAt - Date.now()) / 1000),
	);
	if (player.side === localSide)
		return `You are disconnected. Forfeit in ${remaining}s`;
	return `${player.username || `P${player.side + 1}`} disconnected. Forfeit in ${remaining}s`;
}
