import {
	LocalReplayRuntime,
	type LocalReplayRuntimeOptions,
} from "../runtime/LocalReplayRuntime";

export interface ReplayCaptureRuntimeOptions<
	TSnapshot extends object,
	TPhase extends string,
> extends LocalReplayRuntimeOptions<TSnapshot, TPhase> {
	/**
	 * A monotonic source version lets game adapters reuse the last typed
	 * snapshot when no replay-relevant data changed.
	 */
	snapshotVersion?: () => number | string;
}

/**
 * Shared replay capture façade used by every local game scene. The legacy
 * implementation name remains internal while call sites use the unified v2
 * runtime contract.
 */
export class ReplayCaptureRuntime<
	TSnapshot extends object,
	TPhase extends string,
> extends LocalReplayRuntime<TSnapshot, TPhase> {
	constructor(options: ReplayCaptureRuntimeOptions<TSnapshot, TPhase>) {
		const { buildSnapshot, snapshotVersion, ...runtimeOptions } = options;
		let cachedSnapshot: TSnapshot | null = null;
		let cachedVersion: number | string | undefined;
		super({
			...runtimeOptions,
			buildSnapshot: (phaseOverride) => {
				if (phaseOverride !== undefined || !snapshotVersion)
					return buildSnapshot(phaseOverride);
				const version = snapshotVersion();
				if (
					cachedSnapshot !== null &&
					Object.is(version, cachedVersion)
				)
					return cachedSnapshot;
				cachedVersion = version;
				cachedSnapshot = buildSnapshot();
				return cachedSnapshot;
			},
		});
	}
}
