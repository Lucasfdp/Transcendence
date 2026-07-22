export const FRONTEND_PERFORMANCE_RESOURCES = [
	"phaserGames",
	"replayControllers",
	"replayScenes",
	"canvases",
	"animationFrameLoops",
	"resizeObservers",
] as const;

export type FrontendPerformanceResource =
	(typeof FRONTEND_PERFORMANCE_RESOURCES)[number];

export interface FrontendPerformanceCounter {
	live: number;
	created: number;
	peak: number;
}

export type FrontendPerformanceSnapshot = Record<
	FrontendPerformanceResource,
	FrontendPerformanceCounter
>;

export interface FrontendPerformanceProfiler {
	readonly version: 1;
	readonly commit: string;
	snapshot(): FrontendPerformanceSnapshot;
	reset(): FrontendPerformanceSnapshot;
}

interface MutableFrontendPerformanceProfiler
	extends FrontendPerformanceProfiler {
	mount(resource: FrontendPerformanceResource): () => void;
}

declare global {
	interface Window {
		__SHELL_SMASH_PERFORMANCE__?: FrontendPerformanceProfiler;
	}
}

const GLOBAL_KEY = "__SHELL_SMASH_PERFORMANCE_INTERNAL__";

function createCounters(): FrontendPerformanceSnapshot {
	return Object.fromEntries(
		FRONTEND_PERFORMANCE_RESOURCES.map((resource) => [
			resource,
			{ live: 0, created: 0, peak: 0 },
		]),
	) as FrontendPerformanceSnapshot;
}

function copyCounters(
	counters: FrontendPerformanceSnapshot,
): FrontendPerformanceSnapshot {
	return Object.fromEntries(
		FRONTEND_PERFORMANCE_RESOURCES.map((resource) => [
			resource,
			{ ...counters[resource] },
		]),
	) as FrontendPerformanceSnapshot;
}

function createProfiler(): MutableFrontendPerformanceProfiler {
	const counters = createCounters();
	return {
		version: 1,
		commit: import.meta.env.VITE_APP_COMMIT ?? "unknown",
		snapshot: () => copyCounters(counters),
		reset: () => {
			for (const resource of FRONTEND_PERFORMANCE_RESOURCES) {
				const counter = counters[resource];
				counter.created = counter.live;
				counter.peak = counter.live;
			}
			return copyCounters(counters);
		},
		mount: (resource) => {
			const counter = counters[resource];
			counter.live += 1;
			counter.created += 1;
			counter.peak = Math.max(counter.peak, counter.live);
			let mounted = true;
			return () => {
				if (!mounted) return;
				mounted = false;
				counter.live = Math.max(0, counter.live - 1);
			};
		},
	};
}

function getProfiler(): MutableFrontendPerformanceProfiler | null {
	if (!import.meta.env.DEV || typeof window === "undefined") return null;
	const globalScope = window as typeof window & {
		[GLOBAL_KEY]?: MutableFrontendPerformanceProfiler;
	};
	globalScope[GLOBAL_KEY] ??= createProfiler();
	window.__SHELL_SMASH_PERFORMANCE__ = globalScope[GLOBAL_KEY];
	return globalScope[GLOBAL_KEY];
}

export function installFrontendPerformanceProfiler(): void {
	getProfiler();
}

export function trackFrontendPerformanceResource(
	resource: FrontendPerformanceResource,
): () => void {
	return getProfiler()?.mount(resource) ?? (() => undefined);
}
