import type { ReplayImportRequest } from "../../features/hub/api";
import type { SnapshotPlayer } from "../../services/network/gameSocket";

const DEFAULT_MAX_IMPORTED_REPLAY_FRAMES = 240;

export interface LocalReplayFrameDraft {
	seq: number;
	recordedAt: string;
	deltaMs?: number;
	snapshot: Record<string, unknown>;
}

export interface LocalReplayUser {
	id?: number;
	username?: string;
	turtleName?: string | null;
}

export function createLocalReplayId(gameId: string): string {
	return `local:${gameId}:${Date.now()}`;
}

export function buildLocalReplayPlayers(
	user: LocalReplayUser | undefined,
	playerCount: number,
): SnapshotPlayer[] {
	return Array.from({ length: Math.max(1, playerCount) }, (_value, index) => ({
		side: index,
		userId: index === 0 ? (user?.id ?? null) : null,
		username:
			index === 0
				? (user?.turtleName ?? user?.username ?? "Player 1")
				: `Player ${index + 1}`,
		turtleName: index === 0 ? (user?.turtleName ?? null) : null,
		connected: true,
		ready: true,
		reconnectExpiresAt: null,
	}));
}

export function buildLocalReplayPlayerUserIds(
	userId: number | null | undefined,
	playerCount: number,
): Array<number | null> {
	return Array.from({ length: Math.max(1, playerCount) }, (_value, index) =>
		index === 0 ? (userId ?? null) : null,
	);
}

export function resolveReplayWinnerSide(scores: number[]): number | null {
	if (scores.length <= 1) return null;
	const maxScore = Math.max(...scores);
	const winnerCount = scores.filter((score) => score === maxScore).length;
	if (winnerCount !== 1) return null;
	return scores.findIndex((score) => score === maxScore);
}

export function normalizeReplayImportFrames(
	frames: LocalReplayFrameDraft[],
	maxFrames = DEFAULT_MAX_IMPORTED_REPLAY_FRAMES,
): ReplayImportRequest["frames"] {
	const normalizedFrames = frames.map((frame, index) => ({
		seq: index,
		recordedAt: frame.recordedAt,
		deltaMs:
			index === 0
				? frame.deltaMs
				: Math.max(
						0,
						Date.parse(frame.recordedAt) -
							Date.parse(frames[index - 1]?.recordedAt ?? frame.recordedAt),
					),
		snapshot: frame.snapshot,
	}));

	if (normalizedFrames.length <= maxFrames) return normalizedFrames;

	const keptIndices = new Set<number>([0, normalizedFrames.length - 1]);
	const interiorTarget = maxFrames - 2;
	for (let slot = 0; slot < interiorTarget; slot += 1) {
		const ratio = (slot + 1) / (interiorTarget + 1);
		const index = Math.round(ratio * (normalizedFrames.length - 1));
		keptIndices.add(index);
	}

	return [...keptIndices]
		.sort((left, right) => left - right)
		.map((sourceIndex, compactIndex, indices) => {
			const frame = normalizedFrames[sourceIndex];
			if (compactIndex === 0) return { ...frame, seq: 0 };
			const previousFrame = normalizedFrames[indices[compactIndex - 1]];
			return {
				...frame,
				seq: compactIndex,
				deltaMs: Math.max(
					0,
					Date.parse(frame.recordedAt) - Date.parse(previousFrame.recordedAt),
				),
			};
		});
}
