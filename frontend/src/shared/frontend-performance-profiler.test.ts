import { beforeEach, describe, expect, it } from "vitest";
import {
	installFrontendPerformanceProfiler,
	trackFrontendPerformanceResource,
} from "./frontend-performance-profiler";

describe("frontend performance profiler", () => {
	beforeEach(() => {
		installFrontendPerformanceProfiler();
		window.__SHELL_SMASH_PERFORMANCE__?.reset();
	});

	it("tracks live, created and peak resource counts", () => {
		const releaseFirst =
			trackFrontendPerformanceResource("replayControllers");
		const releaseSecond =
			trackFrontendPerformanceResource("replayControllers");

		expect(
			window.__SHELL_SMASH_PERFORMANCE__?.snapshot().replayControllers,
		).toEqual({ live: 2, created: 2, peak: 2 });

		releaseFirst();
		releaseFirst();
		expect(
			window.__SHELL_SMASH_PERFORMANCE__?.snapshot().replayControllers,
		).toEqual({ live: 1, created: 2, peak: 2 });

		releaseSecond();
	});

	it("resets capture totals without hiding currently live resources", () => {
		const release = trackFrontendPerformanceResource("phaserGames");

		expect(
			window.__SHELL_SMASH_PERFORMANCE__?.reset().phaserGames,
		).toEqual({ live: 1, created: 1, peak: 1 });

		release();
		expect(
			window.__SHELL_SMASH_PERFORMANCE__?.snapshot().phaserGames.live,
		).toBe(0);
	});
});
