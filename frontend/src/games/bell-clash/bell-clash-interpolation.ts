import type { AuthoritativePhysicsSample } from "../common/runtime/authoritative-projection";

/**
 * Legacy Bell Clash interpolation API retained for replay consumers and older
 * callers. Live authoritative renderers use AuthoritativeProjectionTimeline.
 */
export type BellPhysicsSample = AuthoritativePhysicsSample;

export const ONLINE_PHYSICS_BUFFER_SIZE = 8;
export const ONLINE_PHYSICS_DELAY_MS = 100;
export const ONLINE_PHYSICS_MAX_EXTRAPOLATION_MS = 100;

export function interpolateBellPhysics(
	samples: readonly BellPhysicsSample[],
	renderTime: number,
): BellPhysicsSample | null {
	const before = [...samples]
		.reverse()
		.find((sample) => sample.serverTime <= renderTime);
	const after = samples.find((sample) => sample.serverTime >= renderTime);
	if (!before && !after) return null;
	if (!after && before && !before.stopped) {
		const extrapolationMs = Math.min(
			ONLINE_PHYSICS_MAX_EXTRAPOLATION_MS,
			Math.max(0, renderTime - before.serverTime),
		);
		return {
			...before,
			x: before.x + before.vx * (extrapolationMs / 1_000),
			y: before.y + before.vy * (extrapolationMs / 1_000),
			serverTime: before.serverTime + extrapolationMs,
		};
	}
	if (!before || !after || before === after) return { ...(before ?? after)! };

	const spanMs = Math.max(1, after.serverTime - before.serverTime);
	const t = Math.max(0, Math.min(1, (renderTime - before.serverTime) / spanMs));
	const t2 = t * t;
	const t3 = t2 * t;
	const h00 = 2 * t3 - 3 * t2 + 1;
	const h10 = t3 - 2 * t2 + t;
	const h01 = -2 * t3 + 3 * t2;
	const h11 = t3 - t2;
	const spanSeconds = spanMs / 1_000;

	return {
		x:
			h00 * before.x +
			h10 * before.vx * spanSeconds +
			h01 * after.x +
			h11 * after.vx * spanSeconds,
		y:
			h00 * before.y +
			h10 * before.vy * spanSeconds +
			h01 * after.y +
			h11 * after.vy * spanSeconds,
		vx: before.vx + (after.vx - before.vx) * t,
		vy: before.vy + (after.vy - before.vy) * t,
		radius: before.radius + (after.radius - before.radius) * t,
		stopped: after.stopped && t >= 1,
		serverTime: renderTime,
	};
}
