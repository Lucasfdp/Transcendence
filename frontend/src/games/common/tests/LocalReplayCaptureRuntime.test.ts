import { describe, expect, it } from "vitest";

import { LocalReplayCaptureRuntime } from "../runtime/LocalReplayCaptureRuntime";
import { SceneReplayRecorder } from "../localReplay";

describe("LocalReplayCaptureRuntime", () => {
	it("starts and captures replay snapshots through the common capture runtime", () => {
		const recorder = new SceneReplayRecorder<{ phase: string; seq: number }>();
		const runtime = new LocalReplayCaptureRuntime({
			recorder,
			gameId: "bamboo-bash",
			captureStepMs: 100,
			buildSnapshot: (phaseOverride) => ({
				phase: phaseOverride ?? "active",
				seq: recorder.nextSeq(),
			}),
		});

		runtime.start();
		recorder.addElapsed(120);
		runtime.captureTick(120);
		runtime.captureFrame(true, "finished");

		expect(recorder.getFrames().map((frame) => frame.snapshot)).toEqual([
			{ phase: "active", seq: 0 },
			{ phase: "active", seq: 1 },
			{ phase: "finished", seq: 2 },
		]);
	});

	it("skips capture when the scene marks replay capture as unavailable", () => {
		const recorder = new SceneReplayRecorder<{ phase: string }>();
		const runtime = new LocalReplayCaptureRuntime({
			recorder,
			gameId: "bell-clash",
			captureStepMs: 100,
			shouldSkip: () => true,
			buildSnapshot: () => ({ phase: "active" }),
		});

		runtime.start();
		recorder.addElapsed(120);
		runtime.captureTick(120);
		runtime.captureFrame(true);

		expect(recorder.getFrames()).toHaveLength(1);
	});
});
