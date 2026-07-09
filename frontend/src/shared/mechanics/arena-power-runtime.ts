import type { ArenaPixels } from "../arenas/arena";
import {
	type BallState,
	isBallMoving,
	resolveBallCollision,
	stepBall,
} from "./ball-core";
import {
	applyBallCurl,
	applyBallPower,
	type BallExtState,
	BALL_FRICTION_BASE,
} from "./ball-powers";
import { createMirrorBall, createSplitBalls } from "./ball-spawn-powers";
import { PowerType } from "./power-system";

export interface ArenaPowerBallEntry {
	ball: BallState;
	player: number;
}

export function stepArenaBall(
	ball: BallState,
	delta: number,
	arena: ArenaPixels,
): boolean {
	const moving = stepBall(ball, delta, arena);
	const ext = ball as BallExtState;
	if (moving && ext.frictionOverride !== undefined) {
		const factor = Math.pow(
			ext.frictionOverride / BALL_FRICTION_BASE,
			delta / 16.67,
		);
		ball.vx *= factor;
		ball.vy *= factor;
	}
	if (moving) applyBallCurl(ball, delta);
	return moving;
}

export function applyArenaBallPowerCycle(
	power: PowerType,
	ball: BallState,
	arena: ArenaPixels,
	player: number,
): ArenaPowerBallEntry[] {
	if (power === PowerType.SPLITTER) {
		const children = createSplitBalls(ball);
		Object.assign(ball, children[1]);
		return [
			{ ball: children[0], player },
			{ ball: children[2], player },
		];
	}
	if (power === PowerType.MIRROR)
		return [{ ball: createMirrorBall(ball, arena), player }];
	applyBallPower(power, ball, arena);
	return [];
}

export function updateArenaPowerBalls(
	entries: ArenaPowerBallEntry[],
	delta: number,
	arena: ArenaPixels,
	handlers: {
		onMoving?: (entry: ArenaPowerBallEntry) => void;
		onSettled?: (entry: ArenaPowerBallEntry, ext: BallExtState) => void;
	},
): ArenaPowerBallEntry[] {
	const movingEntries: ArenaPowerBallEntry[] = [];
	for (const entry of entries) {
		const moving = stepArenaBall(entry.ball, delta, arena);
		const ext = entry.ball as BallExtState;
		if (moving || isBallMoving(entry.ball)) {
			handlers.onMoving?.(entry);
			movingEntries.push(entry);
		} else handlers.onSettled?.(entry, ext);
	}
	return movingEntries;
}

export function resolveArenaPowerBallCollisions(
	baseBalls: BallState[],
	entries: ArenaPowerBallEntry[],
): void {
	const balls = [...baseBalls, ...entries.map((entry) => entry.ball)];
	for (let i = 0; i < balls.length; i++) {
		for (let j = i + 1; j < balls.length; j++) {
			if (
				(balls[i] as BallExtState).phantomHidden ||
				(balls[j] as BallExtState).phantomHidden
			)
				continue;
			resolveBallCollision(balls[i], balls[j]);
		}
	}
}

export class ArenaPowerRuntime implements Iterable<ArenaPowerBallEntry> {
	private entries: ArenaPowerBallEntry[] = [];

	get length(): number {
		return this.entries.length;
	}

	all(): readonly ArenaPowerBallEntry[] {
		return this.entries;
	}

	push(...entries: ArenaPowerBallEntry[]): number {
		return this.entries.push(...entries);
	}

	applyPower(
		power: PowerType,
		ball: BallState,
		arena: ArenaPixels,
		player: number,
	): number {
		const entries = applyArenaBallPowerCycle(power, ball, arena, player);
		this.push(...entries);
		return entries.length;
	}

	clear(): void {
		this.entries.length = 0;
	}

	map<T>(
		callback: (
			entry: ArenaPowerBallEntry,
			index: number,
			entries: ArenaPowerBallEntry[],
		) => T,
	): T[] {
		return this.entries.map(callback);
	}

	at(index: number): ArenaPowerBallEntry | undefined {
		return this.entries[index];
	}

	forEach(
		callback: (
			entry: ArenaPowerBallEntry,
			index: number,
			entries: ArenaPowerBallEntry[],
		) => void,
	): void {
		this.entries.forEach(callback);
	}

	some(
		callback: (
			entry: ArenaPowerBallEntry,
			index: number,
			entries: ArenaPowerBallEntry[],
		) => boolean,
	): boolean {
		return this.entries.some(callback);
	}

	update(
		delta: number,
		arena: ArenaPixels,
		handlers: {
			onMoving?: (entry: ArenaPowerBallEntry) => void;
			onSettled?: (entry: ArenaPowerBallEntry, ext: BallExtState) => void;
		},
	): readonly ArenaPowerBallEntry[] {
		this.entries = updateArenaPowerBalls(
			this.entries,
			delta,
			arena,
			handlers,
		);
		return this.entries;
	}

	resolveCollisions(baseBalls: BallState[]): void {
		resolveArenaPowerBallCollisions(baseBalls, this.entries);
	}

	[Symbol.iterator](): Iterator<ArenaPowerBallEntry> {
		return this.entries[Symbol.iterator]();
	}
}
