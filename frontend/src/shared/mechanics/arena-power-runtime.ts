import Phaser from "phaser";

import type { ArenaPixels } from "../arenas/arena";
import {
	type BallState,
	drawShellBall,
	isBallMoving,
	resolveBallCollision,
	stepBall,
} from "./ball";
import {
	applyBallCurl,
	applyBallPower,
	type BallExtState,
	BALL_FRICTION_BASE,
} from "./ball-powers";
import { createMirrorBall, createSplitBalls } from "./ball-spawn-powers";
import {
	destroyIngamePlayerTexture,
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
} from "./player-renderer";
import { PowerType } from "./power-system";

export interface ArenaPowerBallEntry {
	ball: BallState;
	player: number;
}

export function applyArenaBallPowerCycle(
	power: PowerType,
	ball: BallState,
	arena: ArenaPixels,
	player: number,
): ArenaPowerBallEntry[] {
	if (power === PowerType.SPLITTER) {
		const children = createSplitBalls(ball);
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
		const moving = stepBall(entry.ball, delta, arena);
		const ext = entry.ball as BallExtState;
		if (moving && ext.frictionOverride !== undefined) {
			const factor = Math.pow(
				ext.frictionOverride / BALL_FRICTION_BASE,
				delta / 16.67,
			);
			entry.ball.vx *= factor;
			entry.ball.vy *= factor;
		}
		if (moving) applyBallCurl(entry.ball, delta);
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

export function clearArenaPowerBallTextures(
	scene: Phaser.Scene,
	prefix: string,
	renderedCount: number,
): void {
	for (let i = 0; i < renderedCount; i++) {
		destroyIngamePlayerTexture(scene, `${prefix}-${i}`);
	}
}

export function drawArenaPowerBalls(
	scene: Phaser.Scene,
	gfx: Phaser.GameObjects.Graphics,
	entries: ArenaPowerBallEntry[],
	renderedCount: number,
	options: {
		prefix: string;
		depth: number;
		playerShellSkins: readonly string[];
		colourForPlayer: (player: number) => number;
		ringScale?: number;
	},
): number {
	for (let i = entries.length; i < renderedCount; i++) {
		hideIngamePlayerTexture(scene, `${options.prefix}-${i}`);
	}
	for (let i = 0; i < entries.length; i++) {
		const { ball, player } = entries[i];
		if (
			!drawIngamePlayerTexture(
				scene,
				`${options.prefix}-${i}`,
				ball,
				options.depth,
				options.playerShellSkins[player],
			)
		)
			drawShellBall(gfx, ball, false);
		gfx.lineStyle(
			Math.max(2, ball.r * 0.14),
			options.colourForPlayer(player),
			0.75,
		);
		gfx.strokeCircle(ball.x, ball.y, ball.r * (options.ringScale ?? 1.06));
	}
	return entries.length;
}
