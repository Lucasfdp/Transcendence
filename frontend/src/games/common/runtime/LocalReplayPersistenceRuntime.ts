import type { ReplayImportRequest } from "../../../features/hub/api";
import {
	buildLocalReplayImportRequest,
	buildLocalReplayPlayerUserIds,
	REPLAY_IMPORT_FRAME_LIMIT,
	trimReplayRoundPreRoll,
	type LocalReplayUser,
	type SceneReplayRecorder,
} from "../localReplay";

export interface LocalReplayPersistenceOptions<TSnapshot extends object> {
	recorder: SceneReplayRecorder<TSnapshot>;
	gameId: string;
	mode: ReplayImportRequest["mode"];
	user: LocalReplayUser | undefined;
	playerCount: number;
	playerNames: string[];
	winnerSide: number | null;
	importReplay: (payload: ReplayImportRequest) => Promise<unknown>;
	frames?: ReplayImportRequest["frames"];
	events?: ReplayImportRequest["events"];
	logLabel?: string;
}

export class LocalReplayPersistenceRuntime {
	private pendingPersist: Promise<void> | null = null;

	reset(): void {
		this.pendingPersist = null;
	}

	start<TSnapshot extends object>(
		options: LocalReplayPersistenceOptions<TSnapshot>,
	): Promise<void> {
		const pending = persistLocalReplayImport(options);
		this.pendingPersist = pending;
		return pending;
	}

	async waitForPending(): Promise<void> {
		try {
			await this.pendingPersist;
		} finally {
			this.pendingPersist = null;
		}
	}
}

export async function persistLocalReplayImport<TSnapshot extends object>(
	options: LocalReplayPersistenceOptions<TSnapshot>,
): Promise<void> {
	if (!options.recorder.getReplayId() || !options.recorder.hasFrames())
		return;
	if (options.user?.isGuest) return;

	const finishedAt = new Date().toISOString();
	const timeline = trimReplayRoundPreRoll(
		options.frames ?? options.recorder.buildImportFrames(),
		options.events ?? options.recorder.getEvents(),
	);
	const importPayload = buildLocalReplayImportRequest({
		gameId: options.gameId,
		mode: options.mode,
		createdAt: options.recorder.getStartedAtIso() || finishedAt,
		finishedAt,
		winnerSide: options.winnerSide,
		playerUserIds: buildLocalReplayPlayerUserIds(
			options.user?.id ?? null,
			options.playerCount,
		),
		playerNames: options.playerNames,
		frames: timeline.frames,
		events: timeline.events,
		replayTooLong:
			options.recorder.getFrames().length > REPLAY_IMPORT_FRAME_LIMIT,
	});

	try {
		await options.importReplay(importPayload);
	} catch (err: unknown) {
		if (options.logLabel) {
			console.warn(
				`[${options.logLabel}] failed to persist replay to backend:`,
				err,
			);
		}
	}
}
