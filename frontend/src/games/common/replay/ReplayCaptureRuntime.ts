import {
	LocalReplayRuntime,
	type LocalReplayRuntimeOptions,
} from "../runtime/LocalReplayRuntime";

/**
 * Shared replay capture façade used by every local game scene. The legacy
 * implementation name remains internal while call sites use the unified v2
 * runtime contract.
 */
export class ReplayCaptureRuntime<
	TSnapshot extends object,
	TPhase extends string,
> extends LocalReplayRuntime<TSnapshot, TPhase> {
	constructor(options: LocalReplayRuntimeOptions<TSnapshot, TPhase>) {
		super(options);
	}
}
