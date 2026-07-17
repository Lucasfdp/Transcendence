import type { SceneReplayRecorder } from "../localReplay";

export interface LocalReplayCaptureRuntimeOptions<
	TSnapshot extends object,
	TPhase extends string,
> {
	recorder: SceneReplayRecorder<TSnapshot>;
	gameId: string;
	captureStepMs: number;
	shouldSkip?: () => boolean;
	buildSnapshot: (phaseOverride?: TPhase) => TSnapshot;
}

export class LocalReplayCaptureRuntime<
	TSnapshot extends object,
	TPhase extends string,
> {
	constructor(
		private readonly options: LocalReplayCaptureRuntimeOptions<
			TSnapshot,
			TPhase
		>,
	) {}

	start(): void {
		if (this.options.shouldSkip?.()) {
			this.options.recorder.reset();
			return;
		}
		this.options.recorder.start(this.options.gameId, (phaseOverride) =>
			this.options.buildSnapshot(phaseOverride as TPhase | undefined),
		);
	}

	captureTick(delta: number): void {
		if (this.options.shouldSkip?.()) return;
		this.options.recorder.captureOnInterval(
			delta,
			this.options.captureStepMs,
			(phaseOverride) =>
				this.options.buildSnapshot(phaseOverride as TPhase | undefined),
		);
	}

	captureFrame(force = false, phaseOverride?: TPhase): void {
		if (this.options.shouldSkip?.()) return;
		this.options.recorder.captureSnapshot(
			(snapshotPhase) =>
				this.options.buildSnapshot(
					(snapshotPhase as TPhase | undefined) ?? phaseOverride,
				),
			{
				force,
				...(phaseOverride ? { phaseOverride } : {}),
			},
		);
	}
}
