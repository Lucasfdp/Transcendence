import type Phaser from "phaser";
import {
	ALL_POWERS,
	PowerType,
} from "./power-system";
import { POWER_UP_TEXTURES } from "./game-powers";

export interface PowerPickup {
	id: number;
	type: PowerType;
	x: number;
	y: number;
	r: number;
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
		this.pickups.length = 0;
		this.draw();
	}

	setPickups(pickups: PowerPickup[]): void {
		this.pickups.length = 0;
		this.pickups.push(...pickups.map((pickup) => ({ ...pickup })));
		this.draw();
	}

	destroy(): void {
		this.clearImages();
		this.pickups.length = 0;
		this.graphics.clear();
	}

	spawn(area: PowerPickupSpawnArea, blockers: PowerPickupBlocker[] = []): PowerPickup | null {
		if (this.pool.length === 0) return null;

		for (let attempt = 0; attempt < this.spawnAttempts; attempt++) {
			const point = area.randomPoint();
			if (!area.contains(point.x, point.y, this.radius)) continue;
			if (!this.canPlace(point.x, point.y, blockers)) continue;

			const pickup: PowerPickup = {
				id: this.nextId++,
				type: Phaser.Math.RND.pick(this.pool),
				x: point.x,
				y: point.y,
				r: this.radius,
			};
			this.pickups.push(pickup);
			return pickup;
		}

		return null;
	}

	collect(x: number, y: number, r: number): PowerPickup | null {
		for (const pickup of [...this.pickups]) {
			if (Math.hypot(x - pickup.x, y - pickup.y) > r + pickup.r) continue;
			this.remove(pickup.id);
			return pickup;
		}
		return null;
	}

	remove(id: number): void {
		const index = this.pickups.findIndex((pickup) => pickup.id === id);
		if (index >= 0) this.pickups.splice(index, 1);
	}

	draw(): void {
		this.graphics.clear();
		this.clearImages();

		for (const pickup of this.pickups) {
			const def = ALL_POWERS[pickup.type];
			const texture = POWER_UP_TEXTURES[pickup.type];
			this.graphics.fillStyle(def.accentColour, 0.25);
			this.graphics.fillCircle(pickup.x, pickup.y, pickup.r * 1.65);
			this.graphics.lineStyle(Math.max(1, pickup.r * 0.11), 0xffffff, 0.75);
			this.graphics.strokeCircle(pickup.x, pickup.y, pickup.r * 1.15);

			if (texture && this.scene.textures.exists(texture)) {
				const image = this.scene.add
					.image(pickup.x, pickup.y, texture)
					.setDepth(this.depth)
					.setDisplaySize(pickup.r * 2.45, pickup.r * 2.45);
				this.images.push(image);
			} else {
				this.graphics.fillStyle(def.accentColour, 0.9);
				this.graphics.fillCircle(pickup.x, pickup.y, pickup.r);
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
				x: Phaser.Math.FloatBetween(bounds.x, bounds.x + bounds.w),
				y: Phaser.Math.FloatBetween(bounds.y, bounds.y + bounds.h),
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
			const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
			const radius = Math.sqrt(Math.random());
			return {
				x: arena.cx + Math.cos(angle) * arena.rx * radius,
				y: arena.cy + Math.sin(angle) * arena.ry * radius,
			};
		},
	};
}
