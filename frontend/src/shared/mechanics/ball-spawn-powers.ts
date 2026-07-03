import type { ArenaPixels } from "../arenas/arena";
import { type BallState } from "./ball";
import { SPLITTER_RADIUS, SPLITTER_SPREAD } from "./power-system";

function cloneBall(ball: BallState): BallState {
	return {
		x: ball.x,
		y: ball.y,
		vx: ball.vx,
		vy: ball.vy,
		r: ball.r,
	};
}

export function createSplitBalls(parent: BallState): BallState[] {
	const speed = Math.hypot(parent.vx, parent.vy);
	const angle = Math.atan2(parent.vy, parent.vx);
	const radius = parent.r * SPLITTER_RADIUS;
	const spawnOffset = Math.max(1, radius * 0.45);

	return [-SPLITTER_SPREAD, 0, SPLITTER_SPREAD].map((offset) => {
		const nextAngle = angle + offset;
		return {
			x: parent.x + Math.cos(nextAngle) * spawnOffset,
			y: parent.y + Math.sin(nextAngle) * spawnOffset,
			vx: Math.cos(nextAngle) * speed * 0.85,
			vy: Math.sin(nextAngle) * speed * 0.85,
			r: radius,
		};
	});
}

export function createMirrorBall(parent: BallState, arena: ArenaPixels): BallState {
	const mirrored = cloneBall(parent);
	mirrored.x = arena.cx * 2 - parent.x;
	mirrored.vx = -parent.vx;
	return mirrored;
}
