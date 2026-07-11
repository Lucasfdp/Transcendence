import type Phaser from "phaser";
import {
	ALL_POWERS,
	PowerType,
} from "./power-system";
import { POWER_UP_TEXTURES } from "./game-powers";
import {
	buildCircularCollectibleDescriptor,
	hitsCircularCollectible,
	remapCollectibleDescriptors,
	resolveCollectiblePosition,
	resolveCollectibleRadius,
	type CollectibleDescriptor,
} from "./collectible-descriptor";
import type { ObstacleArenaFrame } from "./obstacle-descriptor";

export interface PowerPickup {
	id: number;
	type: PowerType;
	x: number;
	y: number;
	r: number;
}

export interface PowerPickupRendering {
	readonly texture?: string;
	readonly accentColour: number;
}

export type PowerPickupCollectibleDescriptor = CollectibleDescriptor<
	"power-pickup",
	PowerType,
	PowerPickupRendering,
	PowerPickup
>;

export interface NormalisedPowerPickupSnapshot {
	readonly id: number;
	readonly type: string;
	readonly nx: number;
	readonly ny: number;
}

export function remapPowerPickups(
	pickups: readonly PowerPickup[],
	mapPickup: (pickup: PowerPickup) => PowerPickup,
): PowerPickup[] {
	return remapCollectibleDescriptors(
		pickups.map((pickup) => powerPickupDescriptor(pickup)),
		(descriptor) => powerPickupDescriptor(mapPickup(powerPickupFromDescriptor(descriptor))),
	).map((descriptor) => powerPickupFromDescriptor(descriptor));
}

export interface PowerPickupSpawnArea {
	contains(x: number, y: number, r: number): boolean;
	randomPoint(): { x: number; y: number };
}

export interface PowerPickupBlocker {
	x: number;
	y: number;
	r: number;
}

interface PowerPickupManagerOptions {
	scene: Phaser.Scene;
	graphics: Phaser.GameObjects.Graphics;
	depth: number;
	pool: PowerType[];
	radius: number;
	spawnAttempts?: number;
	clearance?: number;
}

export class PowerPickupManager {
	private readonly scene: Phaser.Scene;
	private readonly graphics: Phaser.GameObjects.Graphics;
	private readonly depth: number;
	private readonly pool: PowerType[];
	private readonly radius: number;
	private readonly spawnAttempts: number;
	private readonly clearance: number;
	private readonly images: Phaser.GameObjects.Image[] = [];
	private readonly pickups: PowerPickup[] = [];
	private nextId = 0;
	private lastDrawKey: string | null = null;

	constructor(options: PowerPickupManagerOptions) {
		this.scene = options.scene;
		this.graphics = options.graphics;
		this.depth = options.depth;
		this.pool = options.pool;
		this.radius = options.radius;
		this.spawnAttempts = options.spawnAttempts ?? 80;
		this.clearance = options.clearance ?? 12;
	}

	all(): readonly PowerPickup[] {
		return this.pickups;
	}

	clear(): void {
		if (this.pickups.length === 0 && this.lastDrawKey === this.pickupsKey([])) return;
		this.pickups.length = 0;
		this.lastDrawKey = null;
		this.draw();
	}

	setPickups(pickups: PowerPickup[]): void {
		if (this.pickupsKey(pickups) === this.pickupsKey(this.pickups)) return;
		this.pickups.length = 0;
		this.pickups.push(...pickups.map((pickup) => ({ ...pickup })));
		this.lastDrawKey = null;
		this.draw();
	}

	destroy(): void {
		this.clearImages();
		this.pickups.length = 0;
		this.lastDrawKey = null;
		this.graphics.clear();
	}

	spawn(area: PowerPickupSpawnArea, blockers: PowerPickupBlocker[] = []): PowerPickup | null {
		if (this.pool.length === 0) return null;

		for (let attempt = 0; attempt < this.spawnAttempts; attempt++) {
			const point = area.randomPoint();
			if (!area.contains(point.x, point.y, this.radius)) continue;
			if (!this.canPlace(point.x, point.y, blockers)) continue;

			const pickup = powerPickupFromDescriptor(powerPickupDescriptor({
				id: this.nextId++,
				type: pickRandom(this.pool),
				x: point.x,
				y: point.y,
				r: this.radius,
			}));
			this.pickups.push(pickup);
			this.lastDrawKey = null;
			return pickup;
		}

		return null;
	}

	collect(x: number, y: number, r: number): PowerPickup | null {
		for (const pickup of [...this.pickups]) {
			if (!hitsCircularCollectible(powerPickupDescriptor(pickup), undefined, x, y, r))
				continue;
			this.remove(pickup.id);
			return pickup;
		}
		return null;
	}

	remove(id: number): void {
		const index = this.pickups.findIndex((pickup) => pickup.id === id);
		if (index >= 0) {
			this.pickups.splice(index, 1);
			this.lastDrawKey = null;
		}
	}

	draw(): void {
		const drawKey = this.pickupsKey(this.pickups);
		if (drawKey === this.lastDrawKey) return;
		this.lastDrawKey = drawKey;
		this.graphics.clear();
		this.clearImages();

		for (const pickup of this.pickups) {
			const descriptor = powerPickupDescriptor(pickup);
			const position = resolveCollectiblePosition(descriptor);
			const radius = resolveCollectibleRadius(descriptor);
			const accentColour =
				descriptor.rendering?.accentColour ?? ALL_POWERS[pickup.type].accentColour;
			const texture = descriptor.rendering?.texture;
			this.graphics.fillStyle(accentColour, 0.25);
			this.graphics.fillCircle(position.x, position.y, radius * 1.65);
			this.graphics.lineStyle(Math.max(1, radius * 0.11), 0xffffff, 0.75);
			this.graphics.strokeCircle(position.x, position.y, radius * 1.15);

			if (texture && this.scene.textures.exists(texture)) {
				const image = this.scene.add
					.image(position.x, position.y, texture)
					.setDepth(this.depth)
					.setDisplaySize(radius * 2.45, radius * 2.45);
				this.images.push(image);
			} else {
				this.graphics.fillStyle(accentColour, 0.9);
				this.graphics.fillCircle(position.x, position.y, radius);
			}
		}
	}

	private canPlace(x: number, y: number, blockers: PowerPickupBlocker[]): boolean {
		for (const blocker of blockers) {
			if (Math.hypot(x - blocker.x, y - blocker.y) < this.radius + blocker.r + this.clearance)
				return false;
		}

		for (const pickup of this.pickups) {
			if (Math.hypot(x - pickup.x, y - pickup.y) < this.radius + pickup.r + this.clearance)
				return false;
		}

		return true;
	}

	private clearImages(): void {
		for (const image of this.images) image.destroy();
		this.images.length = 0;
	}

	private pickupsKey(pickups: readonly PowerPickup[]): string {
		return JSON.stringify(
			pickups.map((pickup) => ({
				id: pickup.id,
				type: pickup.type,
				x: Math.round(pickup.x * 100) / 100,
				y: Math.round(pickup.y * 100) / 100,
				r: Math.round(pickup.r * 100) / 100,
			})),
		);
	}
}

export function powerPickupDescriptor(
	pickup: PowerPickup,
): PowerPickupCollectibleDescriptor {
	const def = ALL_POWERS[pickup.type];
	return buildCircularCollectibleDescriptor({
		id: pickup.id,
		type: "power-pickup",
		effect: pickup.type,
		position: { mode: "absolute", x: pickup.x, y: pickup.y },
		radius: pickup.r,
		radiusUnit: "pixels",
		serialise: { id: pickup.id, type: pickup.type },
		rendering: {
			texture: POWER_UP_TEXTURES[pickup.type],
			accentColour: def.accentColour,
		},
	});
}

export function powerPickupFromDescriptor(
	descriptor: PowerPickupCollectibleDescriptor,
	arena?: ObstacleArenaFrame,
): PowerPickup {
	const position = resolveCollectiblePosition(descriptor, arena);
	return {
		id: Number(descriptor.id),
		type: descriptor.effect,
		x: position.x,
		y: position.y,
		r: resolveCollectibleRadius(descriptor, arena),
	};
}

export function powerPickupFromNormalisedSnapshot(
	pickup: NormalisedPowerPickupSnapshot,
	arena: ObstacleArenaFrame,
	radius: number,
	resolveType: (type: string) => PowerType,
): PowerPickup {
	return powerPickupFromDescriptor(
		buildCircularCollectibleDescriptor({
			id: pickup.id,
			type: "power-pickup",
			effect: resolveType(pickup.type),
			position: { mode: "normalised", x: pickup.nx, y: pickup.ny },
			radius,
			radiusUnit: "pixels",
			serialise: { ...pickup },
			rendering: {
				texture: POWER_UP_TEXTURES[resolveType(pickup.type)],
				accentColour: ALL_POWERS[resolveType(pickup.type)].accentColour,
			},
		}),
		arena,
	);
}

export function powerPickupToNormalisedSnapshot(
	pickup: PowerPickup,
	arena: ObstacleArenaFrame,
): NormalisedPowerPickupSnapshot {
	return {
		id: pickup.id,
		type: pickup.type,
		nx: (pickup.x - arena.cx) / arena.rx,
		ny: (pickup.y - arena.cy) / arena.ry,
	};
}

export function createRectPowerPickupArea(bounds: {
	x: number;
	y: number;
	w: number;
	h: number;
}): PowerPickupSpawnArea {
	return {
		contains(x, y, r) {
			return x >= bounds.x + r && x <= bounds.x + bounds.w - r && y >= bounds.y + r && y <= bounds.y + bounds.h - r;
		},
		randomPoint() {
			return {
				x: randomFloatBetween(bounds.x, bounds.x + bounds.w),
				y: randomFloatBetween(bounds.y, bounds.y + bounds.h),
			};
		},
	};
}

export function createEllipsePowerPickupArea(arena: {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
}): PowerPickupSpawnArea {
	return {
		contains(x, y, r) {
			const rx = Math.max(1, arena.rx - r);
			const ry = Math.max(1, arena.ry - r);
			const dx = (x - arena.cx) / rx;
			const dy = (y - arena.cy) / ry;
			return dx * dx + dy * dy <= 1;
		},
		randomPoint() {
			const angle = randomFloatBetween(0, Math.PI * 2);
			const radius = Math.sqrt(Math.random());
			return {
				x: arena.cx + Math.cos(angle) * arena.rx * radius,
				y: arena.cy + Math.sin(angle) * arena.ry * radius,
			};
		},
	};
}

function pickRandom<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)] as T;
}

function randomFloatBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}
