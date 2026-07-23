import type { ReplayDetail } from "../../../features/hub/api";
import { trackFrontendPerformanceResource } from "../../../shared/frontend-performance-profiler";
import {
	ReplayController,
	type ReplayControllerState,
} from "../ReplayController";

export type ReplaySessionListener = (state: ReplayControllerState) => void;

export interface ReplaySessionCommands {
	play(): void;
	pause(): void;
	toggle(): void;
	reset(): void;
	seek(frameIndex: number, progress?: number): void;
	seekTime(timeMs: number): void;
}

/**
 * Presentation-independent replay ownership. A mounted viewer owns exactly one
 * session, controller, and playback clock while layout changes remain props.
 */
export class ReplaySession implements ReplaySessionCommands {
	readonly controller: ReplayController;

	private state: ReplayControllerState;
	private readonly listeners = new Set<ReplaySessionListener>();
	private readonly unsubscribeController: () => void;
	private animationFrame = 0;
	private lastAnimationTime = 0;
	private releaseAnimationFrameLoop: (() => void) | null = null;
	private destroyed = false;

	constructor(replay: ReplayDetail) {
		this.controller = new ReplayController(replay);
		this.state = this.controller.getState();
		this.unsubscribeController = this.controller.subscribe((state) => {
			this.state = state;
			for (const listener of this.listeners) listener(state);
		});
	}

	getState = (): ReplayControllerState => this.state;

	subscribe = (listener: ReplaySessionListener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	play(): void {
		this.controller.setPlaying(true);
		this.syncPlaybackClock();
	}

	pause(): void {
		this.controller.setPlaying(false);
		this.stopPlaybackClock();
	}

	toggle(): void {
		if (this.state.playing) this.pause();
		else this.play();
	}

	reset(): void {
		this.controller.seekTime(0);
	}

	seek(frameIndex: number, progress = 0): void {
		this.controller.seek(frameIndex, progress);
	}

	seekTime(timeMs: number): void {
		this.controller.seekTime(timeMs);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stopPlaybackClock();
		this.unsubscribeController();
		this.listeners.clear();
		this.controller.destroy();
	}

	private syncPlaybackClock(): void {
		if (this.destroyed || !this.state.playing || this.animationFrame !== 0)
			return;
		this.releaseAnimationFrameLoop = trackFrontendPerformanceResource(
			"animationFrameLoops",
		);
		this.lastAnimationTime = 0;
		this.animationFrame = window.requestAnimationFrame(this.tick);
	}

	private readonly tick = (now: number): void => {
		if (this.destroyed || !this.state.playing) {
			this.stopPlaybackClock();
			return;
		}
		if (this.lastAnimationTime > 0)
			this.controller.update(Math.max(0, now - this.lastAnimationTime));
		this.lastAnimationTime = now;
		if (this.state.playing)
			this.animationFrame = window.requestAnimationFrame(this.tick);
		else this.stopPlaybackClock();
	};

	private stopPlaybackClock(): void {
		if (this.animationFrame !== 0) {
			window.cancelAnimationFrame(this.animationFrame);
			this.animationFrame = 0;
		}
		this.lastAnimationTime = 0;
		this.releaseAnimationFrameLoop?.();
		this.releaseAnimationFrameLoop = null;
	}
}
