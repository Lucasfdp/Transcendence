import { describe, expect, it } from "vitest";
import { ReplayCaptureRuntime } from "../replay/ReplayCaptureRuntime";
import { reconstructReplayFrame } from "../replay/ReplayEncoder";

describe("ReplayCaptureRuntime", () => {
	it("reuses a typed snapshot while its source version is unchanged", () => {
		let version = 1;
		let builds = 0;
		const runtime = new ReplayCaptureRuntime({
			gameId: "kame-knock",
			captureStepMs: 100,
			snapshotVersion: () => version,
			buildSnapshot: (phaseOverride?: string) => {
				builds += 1;
				return {
					phase: phaseOverride ?? "active",
					version,
					entities: [{ id: "shell", x: version, y: 0 }],
				};
			},
		});

		runtime.startCapture();
		runtime.addElapsed(100);
		runtime.captureTick(100);
		runtime.addElapsed(100);
		runtime.captureTick(100);
		expect(builds).toBe(1);

		version = 2;
		runtime.addElapsed(100);
		runtime.captureTick(100);
		const frames = runtime.buildImportFrames();
		expect(builds).toBe(2);
		expect(frames).toHaveLength(2);
		expect(reconstructReplayFrame(frames, 1)).toMatchObject({
			version: 2,
			entities: [
				{
					id: "shell",
					x: 2,
					y: 0,
					trail: [
						{ x: 1, y: 0 },
						{ x: 2, y: 0 },
					],
				},
			],
		});
	});
});
