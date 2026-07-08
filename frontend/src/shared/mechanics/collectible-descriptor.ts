import type {
	ObstacleArenaFrame,
	ObstacleCircleGeometry,
	ObstaclePoint,
	ObstaclePositionDescriptor,
	ObstacleRadiusUnit,
} from "./obstacle-descriptor";

export interface CollectibleHooks<TCollectible = unknown, TCollector = unknown> {
	readonly onCollect?: (
		collectible: TCollectible,
		collector: TCollector,
	) => void;
	readonly onExpire?: (collectible: TCollectible) => void;
}

export interface CollectibleDescriptor<
	TType extends string = string,
	TEffect = unknown,
	TRendering = unknown,
	TCollectible = unknown,
> {
	readonly id: string | number;
	readonly type: TType;
	readonly effect: TEffect;
	readonly position: ObstaclePositionDescriptor;
	readonly geometry: ObstacleCircleGeometry;
	readonly collectRadius?: number;
	readonly serialise?: Record<string, unknown>;
	readonly rendering?: TRendering;
	readonly hooks?: CollectibleHooks<TCollectible>;
}

export interface CollectibleBlocker {
	readonly x: number;
	readonly y: number;
	readonly r: number;
}

export function buildCircularCollectibleDescriptor<
	TType extends string,
	TEffect,
	TRendering = unknown,
	TCollectible = unknown,
>(options: {
	readonly id: string | number;
	readonly type: TType;
	readonly effect: TEffect;
	readonly position: ObstaclePositionDescriptor;
	readonly radius: number;
	readonly radiusUnit?: ObstacleRadiusUnit;
	readonly collectRadius?: number;
	readonly serialise?: Record<string, unknown>;
	readonly rendering?: TRendering;
	readonly hooks?: CollectibleHooks<TCollectible>;
}): CollectibleDescriptor<TType, TEffect, TRendering, TCollectible> {
	return {
		id: options.id,
		type: options.type,
		effect: options.effect,
		position: options.position,
		geometry: {
			shape: "circle",
			radius: options.radius,
			radiusUnit: options.radiusUnit,
		},
		collectRadius: options.collectRadius,
		serialise: options.serialise,
		rendering: options.rendering,
		hooks: options.hooks,
	};
}

export function resolveCollectiblePosition(
	collectible: Pick<CollectibleDescriptor, "position">,
	arena?: ObstacleArenaFrame,
): ObstaclePoint {
	const { position } = collectible;
	if (position.mode === "absolute") return { x: position.x, y: position.y };
	if (!arena)
		throw new Error("Normalised collectible positions require an arena frame.");
	return {
		x: arena.cx + position.x * arena.rx,
		y: arena.cy + position.y * arena.ry,
	};
}

export function resolveCollectibleRadius(
	collectible: Pick<CollectibleDescriptor, "geometry">,
	arena?: Pick<ObstacleArenaFrame, "rx" | "ry" | "scale">,
): number {
	const unit = collectible.geometry.radiusUnit ?? "source";
	if (unit === "pixels") return collectible.geometry.radius;
	if (!arena)
		throw new Error("Scaled collectible radii require an arena frame.");
	if (unit === "normalised")
		return collectible.geometry.radius * Math.min(arena.rx, arena.ry);
	return collectible.geometry.radius * arena.scale;
}

export function hitsCircularCollectible(
	collectible: Pick<
		CollectibleDescriptor,
		"position" | "geometry" | "collectRadius"
	>,
	arena: ObstacleArenaFrame | undefined,
	cx: number,
	cy: number,
	cr: number,
): boolean {
	const position = resolveCollectiblePosition(collectible, arena);
	const radius =
		collectible.collectRadius ?? resolveCollectibleRadius(collectible, arena);
	const reach = radius + cr;
	const dx = position.x - cx;
	const dy = position.y - cy;
	return dx * dx + dy * dy <= reach * reach;
}

export function collectibleToBlocker(
	collectible: Pick<CollectibleDescriptor, "position" | "geometry">,
	arena?: ObstacleArenaFrame,
	clearance = 0,
): CollectibleBlocker {
	const position = resolveCollectiblePosition(collectible, arena);
	const radius = resolveCollectibleRadius(collectible, arena);
	return { x: position.x, y: position.y, r: radius + clearance };
}

export function remapCollectibleDescriptors<
	TDescriptor extends CollectibleDescriptor,
>(
	collectibles: readonly TDescriptor[],
	mapCollectible: (collectible: TDescriptor) => TDescriptor,
): TDescriptor[] {
	return collectibles.map((collectible) =>
		mapCollectible({
			...collectible,
			position: { ...collectible.position },
			geometry: { ...collectible.geometry },
			serialise: collectible.serialise
				? { ...collectible.serialise }
				: undefined,
			rendering:
				collectible.rendering &&
				typeof collectible.rendering === "object"
					? ({ ...collectible.rendering } as TDescriptor["rendering"])
					: collectible.rendering,
		} as TDescriptor),
	);
}
