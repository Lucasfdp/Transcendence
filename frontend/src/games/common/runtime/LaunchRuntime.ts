import type { ArenaPixels } from "../../../shared/arenas/arena";
import type { BallState } from "../../../shared/mechanics/ball";

export interface LaunchableState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

export interface LaunchableRelayoutOptions<TLaunchable extends LaunchableState> {
	readonly oldArena: ArenaPixels;
	readonly newArena: ArenaPixels;
	readonly launchable: TLaunchable;
	readonly radius?: number;
	readonly isMoving?: (launchable: TLaunchable) => boolean;
	readonly resetWhenStopped?: (launchable: TLaunchable) => void;
}

export interface LaunchStepOptions<TLaunchable extends LaunchableState> {
	readonly launchable: TLaunchable;
	readonly delta: number;
	readonly arena: ArenaPixels;
	readonly step: (
		launchable: TLaunchable,
		delta: number,
		arena: ArenaPixels,
	) => boolean;
	readonly isMoving: (launchable: TLaunchable) => boolean;
	readonly onMoving?: (launchable: TLaunchable) => void;
	readonly onSettled?: (launchable: TLaunchable) => void;
}

export function remapLaunchableToArena<
	TLaunchable extends LaunchableState,
>({
	oldArena,
	newArena,
	launchable,
	radius,
	isMoving,
	resetWhenStopped,
}: LaunchableRelayoutOptions<TLaunchable>): void {
	const moving = isMoving?.(launchable) ?? true;
	if (!moving && resetWhenStopped) {
		resetWhenStopped(launchable);
		return;
	}

	const relX = (launchable.x - oldArena.cx) / oldArena.rx;
	const relY = (launchable.y - oldArena.cy) / oldArena.ry;
	launchable.x = newArena.cx + relX * newArena.rx;
	launchable.y = newArena.cy + relY * newArena.ry;
	launchable.r = radius ?? launchable.r * (newArena.scale / oldArena.scale);

	if (moving) {
		const velocityScale = newArena.scale / oldArena.scale;
		launchable.vx *= velocityScale;
		launchable.vy *= velocityScale;
	}
}

export function stepLaunchable<TLaunchable extends LaunchableState>({
	launchable,
	delta,
	arena,
	step,
	isMoving,
	onMoving,
	onSettled,
}: LaunchStepOptions<TLaunchable>): boolean {
	const steppedMoving = step(launchable, delta, arena);
	if (steppedMoving || isMoving(launchable)) {
		onMoving?.(launchable);
		return true;
	}
	onSettled?.(launchable);
	return false;
}

export type BallLaunchableState = BallState;
