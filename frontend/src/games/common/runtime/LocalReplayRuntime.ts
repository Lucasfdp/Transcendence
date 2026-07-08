import type { ReplayImportRequest } from "../../../features/hub/api";
import { SceneReplayRecorder } from "../../shared/localReplay";
import {
	LocalReplayCaptureRuntime,
	type LocalReplayCaptureRuntimeOptions,
} from "./LocalReplayCaptureRuntime";
import {
	LocalReplayPersistenceRuntime,
	type LocalReplayPersistenceOptions,
} from "./LocalReplayPersistenceRuntime";

export type LocalReplayRuntimeOptions<
	TSnapshot extends object,
	TPhase extends string,
> = Omit<LocalReplayCaptureRuntimeOptions<TSnapshot, TPhase>, "recorder">;

export type LocalReplayRuntimePersistenceOptions<TSnapshot extends object> =
	Omit<LocalReplayPersistenceOptions<TSnapshot>, "recorder">;

export class LocalReplayRuntime<
	TSnapshot extends object,
	TPhase extends string,
> {
	private readonly recorder = new SceneReplayRecorder<TSnapshot>();
	private readonly capture: LocalReplayCaptureRuntime<TSnapshot, TPhase>;
	private readonly persistence = new LocalReplayPersistenceRuntime();

	constructor(options: LocalReplayRuntimeOptions<TSnapshot, TPhase>) {
		this.capture = new LocalReplayCaptureRuntime({
			...options,
			recorder: this.recorder,
		});
	}

	reset(): void {
		this.recorder.reset();
		this.persistence.reset();
	}

	startCapture(): void {
		this.capture.start();
	}

	addElapsed(delta: number): void {
		this.recorder.addElapsed(delta);
	}

	captureTick(delta: number): void {
		this.capture.captureTick(delta);
	}

	captureFrame(force = false, phaseOverride?: TPhase): void {
		this.capture.captureFrame(force, phaseOverride);
	}

	resetCaptureAccumulator(): void {
		this.recorder.resetCaptureAccumulator();
	}

	getReplayId(): string | null {
		return this.recorder.getReplayId();
	}

	getStartedAtIso(): string {
		return this.recorder.getStartedAtIso();
	}

	nextSeq(): number {
		return this.recorder.nextSeq();
	}

	persist(
		options: LocalReplayRuntimePersistenceOptions<TSnapshot>,
	): Promise<void> {
		return this.persistence.start({
			...options,
			recorder: this.recorder,
		});
	}

	waitForPendingPersist(): Promise<void> {
		return this.persistence.waitForPending();
	}

	buildImportFrames(): ReplayImportRequest["frames"] {
		return this.recorder.buildImportFrames();
	}
}
