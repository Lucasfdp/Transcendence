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
	private readonly buildSnapshot: (phaseOverride?: string) => TSnapshot;

	constructor(
		private readonly options: LocalReplayCaptureRuntimeOptions<
			TSnapshot,
			TPhase
		>,
	) {
		// The recorder asks for this callback on every render tick, even though
		// it samples less frequently. Retaining one adapter avoids allocating a
		// closure on every frame in all four local games.
		this.buildSnapshot = (phaseOverride) =>
			this.options.buildSnapshot(phaseOverride as TPhase | undefined);
	}

	start(): void {
		if (this.options.shouldSkip?.()) {
			this.options.recorder.reset();
			return;
		}
		this.options.recorder.start(this.options.gameId, this.buildSnapshot);
	}

	captureTick(delta: number): void {
		if (this.options.shouldSkip?.()) return;
		this.options.recorder.captureOnInterval(
			delta,
			this.options.captureStepMs,
			this.buildSnapshot,
		);
	}

	captureFrame(force = false, phaseOverride?: TPhase): void {
		if (this.options.shouldSkip?.()) return;
		this.options.recorder.captureSnapshot(this.buildSnapshot, {
			force,
			...(phaseOverride ? { phaseOverride } : {}),
		});
	}
}
