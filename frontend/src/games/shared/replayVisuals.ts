import type {
	ReplayFrameSnapshot,
	ReplaySnapshotEntity,
	ReplayVisualPlayer,
} from "../../features/hub/api";

export const DEFAULT_REPLAY_BACKGROUND = "night_bg";

export const REPLAY_BACKGROUND_TEXTURES: Record<string, string> = {
	night_bg: "replay-background-night_bg",
	night_cycle_bg: "replay-background-night_cycle_bg",
	sunset_bg: "replay-background-sunset_bg",
	sunset_cycle_bg: "replay-background-sunset_cycle_bg",
	sunrise_bg: "replay-background-sunrise_bg",
	sunrise_cycle_bg: "replay-background-sunrise_cycle_bg",
};

export function resolveActiveReplaySide(
	snapshot: ReplayFrameSnapshot,
	lastActiveSide: number | null = null,
): number {
	if (typeof snapshot.currentTurn === "number") return snapshot.currentTurn;

	const activeStoneSide = resolveSideFromActiveEntity(
		snapshot.activeStoneId,
		snapshot.objects ?? snapshot.entities,
	);
	if (activeStoneSide !== null) return activeStoneSide;

	const activeBallSide = resolveSideFromActiveBall(snapshot);
	if (activeBallSide !== null) return activeBallSide;

	return lastActiveSide ?? 0;
}

export function resolveActiveReplayBackground(
	snapshot: ReplayFrameSnapshot,
	activeSide: number,
): string {
	const player = resolveReplayPlayer(snapshot.players, activeSide);
	const preferred =
		normalizeReplayBackgroundId(player?.hubBackgroundAlter) ??
		normalizeReplayBackgroundId(player?.hubBackground) ??
		DEFAULT_REPLAY_BACKGROUND;
	return REPLAY_BACKGROUND_TEXTURES[preferred]
		? preferred
		: DEFAULT_REPLAY_BACKGROUND;
}

function resolveSideFromActiveBall(snapshot: ReplayFrameSnapshot): number | null {
	const activeBallIds = snapshot.activeBallIdBySide;
	if (!Array.isArray(activeBallIds)) return null;
	const entities = snapshot.entities ?? snapshot.balls ?? [];
	for (let side = 0; side < activeBallIds.length; side += 1) {
		const activeBallId = activeBallIds[side];
		if (activeBallId === null || activeBallId === undefined) continue;
		return resolveSideFromActiveEntity(activeBallId, entities) ?? side;
	}
	return null;
}

function resolveSideFromActiveEntity(
	activeId: number | string | null | undefined,
	entities: ReplaySnapshotEntity[] | undefined,
): number | null {
	if (activeId === null || activeId === undefined || !entities) return null;
	const activeIdKey = String(activeId);
	const entity = entities.find((entry) => String(entry.id) === activeIdKey);
	if (!entity) return null;
	if (typeof entity.side === "number") return entity.side;
	if (typeof entity.ownerSide === "number") return entity.ownerSide;
	return null;
}

function resolveReplayPlayer(
	players: ReplayVisualPlayer[] | undefined,
	activeSide: number,
): ReplayVisualPlayer | null {
	if (!players?.length) return null;
	return (
		players.find((player) => player.side === activeSide) ??
		players[activeSide] ??
		players[0] ??
		null
	);
}

function normalizeReplayBackgroundId(
	backgroundId: string | null | undefined,
): string | null {
	if (!backgroundId) return null;
	if (backgroundId === "cycle_bg") return "night_cycle_bg";
	return backgroundId;
}
