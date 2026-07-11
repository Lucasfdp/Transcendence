import type {
	ReplayDetail,
	ReplayEvent,
	ReplayFrame,
} from "../../features/hub/api";

export interface ReplayControllerState {
	replay: ReplayDetail | null;
	frameIndex: number;
	progress: number;
	playing: boolean;
	timeMs: number;
	frame: ReplayFrame | null;
	nextFrame: ReplayFrame | null;
}

type ReplayListener = (state: ReplayControllerState) => void;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function frameWindow(
	replay: ReplayDetail | null,
	frameIndex: number,
): { frame: ReplayFrame | null; nextFrame: ReplayFrame | null } {
	if (!replay || replay.frames.length === 0) {
		return { frame: null, nextFrame: null };
	}
	const safeIndex = Math.min(
		Math.max(frameIndex, 0),
		Math.max(replay.frames.length - 1, 0),
	);
	return {
		frame: replay.frames[safeIndex] ?? null,
		nextFrame: replay.frames[safeIndex + 1] ?? null,
	};
}

function getFrameDurationMs(
	replay: ReplayDetail | null,
	frameIndex: number,
): number {
	if (!replay) return 0;
	const currentFrame = replay.frames[frameIndex];
	const nextFrame = replay.frames[frameIndex + 1];
	if (!currentFrame || !nextFrame) return 0;
	if (typeof nextFrame.deltaMs === "number" && Number.isFinite(nextFrame.deltaMs))
		return Math.max(0, nextFrame.deltaMs);

	const currentTime = new Date(currentFrame.recordedAt).getTime();
	const nextTime = new Date(nextFrame.recordedAt).getTime();
	return Math.max(0, nextTime - currentTime);
}

function playbackTime(
	replay: ReplayDetail | null,
	frameIndex: number,
	progress: number,
): number {
	const window = frameWindow(replay, frameIndex);
	if (!window.frame) return Date.now();
	const frameTime = new Date(window.frame.recordedAt).getTime();
	const duration = getFrameDurationMs(replay, frameIndex);
	return frameTime + duration * clamp01(progress);
}

export class ReplayController {
	private replay: ReplayDetail | null;
	private frameIndex = 0;
	private progress = 0;
	private playing = false;
	private readonly listeners = new Set<ReplayListener>();

	constructor(replay: ReplayDetail | null = null) {
		this.replay = replay;
	}

	subscribe(listener: ReplayListener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => {
			this.listeners.delete(listener);
		};
	}

	setReplay(replay: ReplayDetail | null): void {
		this.replay = replay;
		this.frameIndex = 0;
		this.progress = 0;
		this.playing = false;
		this.emit();
	}

	setPlayback(frameIndex: number, progress: number, playing: boolean): void {
		this.frameIndex = Math.max(0, frameIndex);
		this.progress = clamp01(progress);
		this.playing = playing;
		this.emit();
	}

	seek(frameIndex: number, progress = 0): void {
		this.frameIndex = Math.max(0, frameIndex);
		this.progress = clamp01(progress);
		this.emit();
	}

	update(deltaMs: number): void {
		if (!this.playing || !this.replay || this.replay.frames.length <= 1) return;
		if (this.frameIndex >= this.replay.frames.length - 1) {
			this.playing = false;
			this.emit();
			return;
		}

		let remainingDeltaMs = Math.max(0, deltaMs);
		let changed = false;

		while (remainingDeltaMs > 0 && this.playing) {
			const duration = getFrameDurationMs(this.replay, this.frameIndex);
			if (duration <= 0) {
				if (this.frameIndex >= this.replay.frames.length - 2) {
					this.frameIndex = this.replay.frames.length - 1;
					this.progress = 0;
					this.playing = false;
					changed = true;
					break;
				}
				this.frameIndex += 1;
				this.progress = 0;
				changed = true;
				continue;
			}

			const remainingFrameMs = duration * (1 - this.progress);
			if (remainingDeltaMs >= remainingFrameMs) {
				remainingDeltaMs -= remainingFrameMs;
				if (this.frameIndex >= this.replay.frames.length - 2) {
					this.frameIndex = this.replay.frames.length - 1;
					this.progress = 0;
					this.playing = false;
					changed = true;
					break;
				}
				this.frameIndex += 1;
				this.progress = 0;
				changed = true;
				continue;
			}

			this.progress = clamp01(this.progress + remainingDeltaMs / duration);
			remainingDeltaMs = 0;
			changed = true;
		}

		if (!changed && this.frameIndex >= this.replay.frames.length - 1) {
			this.playing = false;
			this.progress = 0;
			this.emit();
			return;
		}

		if (this.frameIndex >= this.replay.frames.length - 1) {
			if (this.playing) {
				this.frameIndex = this.replay.frames.length - 1;
				this.progress = 0;
				this.playing = false;
			}
		}
		this.emit();
	}

	getEventsUpTo(timeMs: number): ReplayEvent[] {
		if (!this.replay) return [];
		return this.replay.events.filter(
			(event) => new Date(event.recordedAt).getTime() <= timeMs,
		);
	}

	getState(): ReplayControllerState {
		const window = frameWindow(this.replay, this.frameIndex);
		return {
			replay: this.replay,
			frameIndex: this.frameIndex,
			progress: this.progress,
			playing: this.playing,
			timeMs: playbackTime(this.replay, this.frameIndex, this.progress),
			frame: window.frame,
			nextFrame: window.nextFrame,
		};
	}

	private emit(): void {
		const state = this.getState();
		for (const listener of this.listeners) listener(state);
	}
}
