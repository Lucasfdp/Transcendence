import {
	resolveCurlingBallCollision,
	type CurlingBallState,
	stepCurlingBall as stepCurlingBall,
} from "./ball";
import {
	type PowerRegistry,
	PowerType,
	SPLITTER_RADIUS,
	SPLITTER_SPREAD,
} from "./power-system";
import type { RectArenaPixels } from "./rect-arena";

export interface CurlingPowerSpawnResult {
	readonly children: CurlingBallState[];
	readonly split: boolean;
	readonly mirror: boolean;
	readonly removeSource: boolean;
}

export interface CurlingCollisionOptions {
	readonly activeBall?: CurlingBallState | null;
	readonly skipActivePairs?: boolean;
	readonly triggerActiveCollisionPower?: boolean;
}

export class CurlingPowerRuntime {
	constructor(
		private readonly registry: PowerRegistry,
		private readonly nextBallId: () => number,
	) {}

	applyPower(
		power: PowerType,
		ball: CurlingBallState,
		arena: RectArenaPixels,
	): void {
		ball.power = power;
		this.registry.get(power).onApply(ball, arena);
	}

	stepCurlingBall(
		ball: CurlingBallState,
		delta: number,
		arena: RectArenaPixels,
	): boolean {
		return stepCurlingBall(ball, delta, arena);
	}

	updatePower(
		ball: CurlingBallState,
		delta: number,
		arena: RectArenaPixels,
	): void {
		this.registry.get(ball.power).onUpdate?.(ball, delta, arena);
	}

	collidePower(
		ball: CurlingBallState,
		other: CurlingBallState,
		arena: RectArenaPixels,
	): void {
		this.registry.get(ball.power).onCollide?.(ball, other, arena);
	}

	stopPower(
		ball: CurlingBallState,
		arena: RectArenaPixels,
		allBalls: CurlingBallState[],
	): void {
		this.registry.get(ball.power).onStop?.(ball, arena, allBalls);
	}

	resolveCollisions(
		balls: readonly CurlingBallState[],
		arena: RectArenaPixels,
		options: CurlingCollisionOptions = {},
	): void {
		const active = options.activeBall ?? null;
		for (let i = 0; i < balls.length; i++) {
			for (let j = i + 1; j < balls.length; j++) {
				const a = balls[i];
				const b = balls[j];
				const includesActive = active === a || active === b;
				if (options.skipActivePairs && includesActive) continue;
				if (this.isPhantomHidden(a) || this.isPhantomHidden(b))
					continue;

				const colliding =
					Boolean(
						active &&
						options.triggerActiveCollisionPower &&
						includesActive,
					) && this.ballsOverlapping(a, b);
				resolveCurlingBallCollision(a, b);
				if (colliding && active)
					this.collidePower(active, active === a ? b : a, arena);
			}
		}
	}

	consumeSpawnRequests(
		ball: CurlingBallState,
		arena: RectArenaPixels,
	): CurlingPowerSpawnResult {
		const children: CurlingBallState[] = [];
		let split = false;
		let mirror = false;
		let removeSource = false;

		if (ball.splitterPending) {
			ball.splitterPending = false;
			children.push(...this.createSplitBalls(ball));
			split = true;
			removeSource = true;
		}
		if (ball.mirrorPending) {
			ball.mirrorPending = false;
			children.push(this.createMirrorBall(ball, arena));
			mirror = true;
		}

		return { children, split, mirror, removeSource };
	}

	private createSplitBalls(parent: CurlingBallState): CurlingBallState[] {
		const parentSpeed = Math.hypot(parent.vx, parent.vy);
		const parentAngle = Math.atan2(parent.vy, parent.vx);
		const childRadius = parent.r * SPLITTER_RADIUS;
		const spawnOffset = Math.max(1, childRadius * 0.45);

		return [-SPLITTER_SPREAD, 0, SPLITTER_SPREAD].map((offset) => {
			const angle = parentAngle + offset;
			return {
				id: this.nextBallId(),
				teamId: parent.teamId,
				x: parent.x + Math.cos(angle) * spawnOffset,
				y: parent.y + Math.sin(angle) * spawnOffset,
				vx: Math.cos(angle) * parentSpeed * 0.7,
				vy: Math.sin(angle) * parentSpeed * 0.7,
				r: childRadius,
				power: PowerType.NONE,
				stopped: false,
				curlBias: parent.curlBias,
			};
		});
	}

	private createMirrorBall(
		parent: CurlingBallState,
		arena: RectArenaPixels,
	): CurlingBallState {
		const mirroredY =
			arena.sheetY + arena.sheetH - (parent.y - arena.sheetY);
		return {
			id: this.nextBallId(),
			teamId: parent.teamId,
			x: parent.x,
			y: mirroredY,
			vx: parent.vx,
			vy: -parent.vy,
			r: parent.r,
			power: PowerType.NONE,
			stopped: false,
			curlBias: -parent.curlBias,
		};
	}

	private isPhantomHidden(ball: CurlingBallState): boolean {
		return Boolean((ball as { phantomHidden?: boolean }).phantomHidden);
	}

	private ballsOverlapping(a: CurlingBallState, b: CurlingBallState): boolean {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return Math.hypot(dx, dy) < a.r + b.r;
	}
}
