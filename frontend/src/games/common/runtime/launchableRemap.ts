export interface RuntimeArenaFrame {
	readonly originX: number;
	readonly originY: number;
	readonly width: number;
	readonly height: number;
	readonly velocityScale: number;
}

export interface OvalArenaLike {
	readonly cx: number;
	readonly cy: number;
	readonly rx: number;
	readonly ry: number;
	readonly scale: number;
}

export interface RectArenaLike {
	readonly sheetX: number;
	readonly sheetY: number;
	readonly sheetW: number;
	readonly sheetH: number;
	readonly scale: number;
}

export interface RuntimeLaunchable {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
}

export interface RemappedLaunchable extends RuntimeLaunchable {
	readonly nx: number;
	readonly ny: number;
	readonly nvx: number;
	readonly nvy: number;
}

export function frameFromOvalArena(arena: OvalArenaLike): RuntimeArenaFrame {
	return {
		originX: arena.cx - arena.rx,
		originY: arena.cy - arena.ry,
		width: arena.rx * 2,
		height: arena.ry * 2,
		velocityScale: arena.scale,
	};
}

export function frameFromRectArena(arena: RectArenaLike): RuntimeArenaFrame {
	return {
		originX: arena.sheetX,
		originY: arena.sheetY,
		width: arena.sheetW,
		height: arena.sheetH,
		velocityScale: arena.scale,
	};
}

export function remapLaunchable<T extends RuntimeLaunchable>(
	launchable: T,
	from: RuntimeArenaFrame,
	to: RuntimeArenaFrame,
): T & RemappedLaunchable {
	assertValidFrame(from, "from");
	assertValidFrame(to, "to");

	const nx = (launchable.x - from.originX) / from.width;
	const ny = (launchable.y - from.originY) / from.height;
	const nvx = launchable.vx / from.velocityScale;
	const nvy = launchable.vy / from.velocityScale;

	return {
		...launchable,
		x: to.originX + nx * to.width,
		y: to.originY + ny * to.height,
		vx: nvx * to.velocityScale,
		vy: nvy * to.velocityScale,
		nx,
		ny,
		nvx,
		nvy,
	};
}

export function remapLaunchables<T extends RuntimeLaunchable>(
	launchables: readonly T[],
	from: RuntimeArenaFrame,
	to: RuntimeArenaFrame,
): Array<T & RemappedLaunchable> {
	return launchables.map((launchable) => remapLaunchable(launchable, from, to));
}

function assertValidFrame(frame: RuntimeArenaFrame, name: string): void {
	if (
		!Number.isFinite(frame.originX) ||
		!Number.isFinite(frame.originY) ||
		!Number.isFinite(frame.width) ||
		!Number.isFinite(frame.height) ||
		!Number.isFinite(frame.velocityScale)
	) {
		throw new Error(`Invalid ${name} arena frame: values must be finite`);
	}
	if (frame.width <= 0 || frame.height <= 0)
		throw new Error(`Invalid ${name} arena frame: size must be positive`);
	if (frame.velocityScale <= 0)
		throw new Error(
			`Invalid ${name} arena frame: velocityScale must be positive`,
		);
}
