import type { ArenaPixels } from "../arenas/arena";

export type ObstacleArenaFrame = Pick<
	ArenaPixels,
	"cx" | "cy" | "rx" | "ry" | "scale"
>;
export type ObstaclePositionMode = "normalised" | "absolute";
export type ObstacleRadiusUnit = "source" | "pixels" | "normalised";

export interface ObstaclePositionDescriptor {
	readonly mode: ObstaclePositionMode;
	readonly x: number;
	readonly y: number;
}

export interface ObstacleCircleGeometry {
	readonly shape: "circle";
	readonly radius: number;
	readonly radiusUnit?: ObstacleRadiusUnit;
}

export interface ObstacleBoundsGeometry {
	readonly shape: "bounds";
	readonly width: number;
	readonly height: number;
	readonly unit?: ObstacleRadiusUnit;
}

export type ObstacleGeometry = ObstacleCircleGeometry | ObstacleBoundsGeometry;

export interface ObstacleCollisionDescriptor {
	readonly blocks?: boolean;
	readonly bounces?: boolean;
	readonly breaks?: boolean;
	readonly awardsPoints?: boolean;
}

export interface ObstacleHooks<TObstacle = unknown> {
	readonly onHit?: (obstacle: TObstacle) => void;
	readonly onExpire?: (obstacle: TObstacle) => void;
	readonly onScore?: (obstacle: TObstacle, score: number) => void;
}

export interface ObstacleDescriptor<
	TType extends string = string,
	TRendering = unknown,
	TObstacle = unknown,
> {
	readonly id: string | number;
	readonly type: TType;
	readonly position: ObstaclePositionDescriptor;
	readonly geometry: ObstacleGeometry;
	readonly scoreValue?: number;
	readonly health?: number;
	readonly collision?: ObstacleCollisionDescriptor;
	readonly rendering?: TRendering;
	readonly hooks?: ObstacleHooks<TObstacle>;
}

export interface ObstaclePoint {
	readonly x: number;
	readonly y: number;
}

export interface ObstacleBlocker {
	readonly x: number;
	readonly y: number;
	readonly r: number;
}

export function resolveObstaclePosition(
	obstacle: Pick<ObstacleDescriptor, "position">,
	arena?: ObstacleArenaFrame,
): ObstaclePoint {
	const { position } = obstacle;
	if (position.mode === "absolute") return { x: position.x, y: position.y };
	if (!arena)
		throw new Error("Normalised obstacle positions require an arena frame.");
	return {
		x: arena.cx + position.x * arena.rx,
		y: arena.cy + position.y * arena.ry,
	};
}

export function resolveObstacleRadius(
	obstacle: Pick<ObstacleDescriptor, "geometry">,
	arena?: Pick<ObstacleArenaFrame, "rx" | "ry" | "scale">,
): number | null {
	if (obstacle.geometry.shape !== "circle") return null;
	const unit = obstacle.geometry.radiusUnit ?? "source";
	if (unit === "pixels") return obstacle.geometry.radius;
	if (!arena)
		throw new Error("Scaled obstacle radii require an arena frame.");
	if (unit === "normalised")
		return obstacle.geometry.radius * Math.min(arena.rx, arena.ry);
	return obstacle.geometry.radius * arena.scale;
}

export function hitsCircularObstacle(
	obstacle: Pick<ObstacleDescriptor, "position" | "geometry">,
	arena: ObstacleArenaFrame | undefined,
	cx: number,
	cy: number,
	cr: number,
): boolean {
	const radius = resolveObstacleRadius(obstacle, arena);
	if (radius === null) return false;
	const position = resolveObstaclePosition(obstacle, arena);
	const reach = radius + cr;
	const dx = position.x - cx;
	const dy = position.y - cy;
	return dx * dx + dy * dy <= reach * reach;
}

export function obstacleToBlocker(
	obstacle: Pick<ObstacleDescriptor, "position" | "geometry">,
	arena?: ObstacleArenaFrame,
	clearance = 0,
): ObstacleBlocker | null {
	const radius = resolveObstacleRadius(obstacle, arena);
	if (radius === null) return null;
	const position = resolveObstaclePosition(obstacle, arena);
	return { x: position.x, y: position.y, r: radius + clearance };
}

export function buildCircularObstacleDescriptor<
	TType extends string,
	TRendering = unknown,
	TObstacle = unknown,
>(options: {
	readonly id: string | number;
	readonly type: TType;
	readonly position: ObstaclePositionDescriptor;
	readonly radius: number;
	readonly radiusUnit?: ObstacleRadiusUnit;
	readonly scoreValue?: number;
	readonly health?: number;
	readonly collision?: ObstacleCollisionDescriptor;
	readonly rendering?: TRendering;
	readonly hooks?: ObstacleHooks<TObstacle>;
}): ObstacleDescriptor<TType, TRendering, TObstacle> {
	return {
		id: options.id,
		type: options.type,
		position: options.position,
		geometry: {
			shape: "circle",
			radius: options.radius,
			radiusUnit: options.radiusUnit,
		},
		scoreValue: options.scoreValue,
		health: options.health,
		collision: options.collision,
		rendering: options.rendering,
		hooks: options.hooks,
	};
}
