import type {
	ReplayDetail,
	ReplayEvent,
	ReplayFrame,
	ReplayFrameSnapshot,
} from "../../features/hub/api";
import { reconstructReplayFrame } from "./replay/ReplayEncoder";

export type ResolvedReplayFrame = ReplayFrame & {
	snapshot: ReplayFrameSnapshot;
};

export interface ReplayControllerState {
	replay: ReplayDetail | null;
	frameIndex: number;
	progress: number;
	playing: boolean;
	timeMs: number;
	frame: ResolvedReplayFrame | null;
	nextFrame: ResolvedReplayFrame | null;
}

type ReplayListener = (state: ReplayControllerState) => void;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function replayPlaybackDuration(replay: ReplayDetail | null): number {
	if (!replay || replay.frames.length === 0) return 0;
	const lastFrameMs = replay.frames[replay.frames.length - 1]?.tMs ?? 0;
	const terminalFrame = replay.frames.find(
		(frame) => frame.state === "finished" || frame.state === "abandoned",
	);
	const capturedDuration = terminalFrame?.tMs ?? lastFrameMs;
	return Math.max(
		0,
		Math.min(
			replay.durationMs > 0 ? replay.durationMs : capturedDuration,
			capturedDuration,
		),
	);
}

export class ReplayController {
	private replay: ReplayDetail | null;
	private timeMs = 0;
	private playing = false;
	private readonly listeners = new Set<ReplayListener>();
	private readonly reconstructionCache = new Map<
		number,
		ReplayFrameSnapshot
	>();
	private lastEmittedAt = -Infinity;

	constructor(replay: ReplayDetail | null = null) {
		this.replay = replay;
	}

	subscribe(listener: ReplayListener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => this.listeners.delete(listener);
	}

	setReplay(replay: ReplayDetail | null): void {
		this.replay = replay;
		this.timeMs = 0;
		this.playing = false;
		this.reconstructionCache.clear();
		this.emit(true);
	}

	setPlayback(frameIndex: number, progress: number, playing: boolean): void {
		const frame = this.replay?.frames[frameIndex];
		const next = this.replay?.frames[frameIndex + 1];
		this.timeMs = clamp(
			frame
				? frame.tMs +
				Math.max(0, (next?.tMs ?? frame.tMs) - frame.tMs) *
					clamp(progress, 0, 1)
				: 0,
			0,
			replayPlaybackDuration(this.replay),
		);
		this.playing =
			playing && this.timeMs < replayPlaybackDuration(this.replay);
		this.emit(true);
	}

	seek(frameIndex: number, progress = 0): void {
		this.setPlayback(frameIndex, progress, this.playing);
	}

	seekTime(timeMs: number): void {
		this.timeMs = clamp(timeMs, 0, replayPlaybackDuration(this.replay));
		this.emit(true);
	}

	setPlaying(playing: boolean): void {
		this.playing =
			playing && this.timeMs < replayPlaybackDuration(this.replay);
		this.emit(true);
	}

	update(deltaMs: number): void {
		if (!this.playing || !this.replay) return;
		const durationMs = replayPlaybackDuration(this.replay);
		this.timeMs = Math.min(
			durationMs,
			this.timeMs + Math.max(0, deltaMs),
		);
		if (this.timeMs >= durationMs) this.playing = false;
		this.emit(!this.playing || this.timeMs - this.lastEmittedAt >= 100);
	}

	getEventsUpTo(timeMs: number): ReplayEvent[] {
		return this.replay?.events.filter((event) => event.tMs <= timeMs) ?? [];
	}

	getState(): ReplayControllerState {
		const frameIndex = this.findFrameIndex(this.timeMs);
		const frame = this.resolveFrame(frameIndex);
		const candidateNextFrame = this.resolveFrame(frameIndex + 1);
		const nextFrame =
			candidateNextFrame &&
			candidateNextFrame.tMs <= replayPlaybackDuration(this.replay)
				? candidateNextFrame
				: null;
		const windowMs =
			frame && nextFrame ? Math.max(0, nextFrame.tMs - frame.tMs) : 0;
		return {
			replay: this.replay,
			frameIndex,
			progress:
				frame && windowMs > 0
					? clamp((this.timeMs - frame.tMs) / windowMs, 0, 1)
					: 0,
			playing: this.playing,
			timeMs: this.timeMs,
			frame,
			nextFrame,
		};
	}

	private findFrameIndex(timeMs: number): number {
		const frames = this.replay?.frames ?? [];
		if (frames.length === 0) return 0;
		let low = 0;
		let high = frames.length - 1;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			if ((frames[middle]?.tMs ?? 0) <= timeMs) low = middle + 1;
			else high = middle - 1;
		}
		return Math.max(0, high);
	}

	private resolveFrame(index: number): ResolvedReplayFrame | null {
		const frames = this.replay?.frames;
		const frame = frames?.[index];
		if (!frames || !frame) return null;
		let snapshot = this.reconstructionCache.get(index);
		if (!snapshot) {
			snapshot = reconstructReplayFrame(
				frames,
				index,
			) as ReplayFrameSnapshot;
			this.reconstructionCache.set(index, snapshot);
			while (this.reconstructionCache.size > 24) {
				const oldest = this.reconstructionCache.keys().next().value as
					| number
					| undefined;
				if (oldest === undefined) break;
				this.reconstructionCache.delete(oldest);
			}
		}
		return { ...frame, snapshot };
	}

	private emit(force: boolean): void {
		if (!force) return;
		this.lastEmittedAt = this.timeMs;
		const state = this.getState();
		for (const listener of this.listeners) listener(state);
	}
}
