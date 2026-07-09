import {
	resolveStoneCollision,
	type StoneState,
	stepStone as stepCurlingStone,
} from "./ball";
import {
	type PowerRegistry,
	PowerType,
	SPLITTER_RADIUS,
	SPLITTER_SPREAD,
} from "./power-system";
import type { RectArenaPixels } from "./rect-arena";

export interface CurlingPowerSpawnResult {
	readonly children: StoneState[];
	readonly split: boolean;
	readonly mirror: boolean;
	readonly removeSource: boolean;
}

export interface CurlingCollisionOptions {
	readonly activeStone?: StoneState | null;
	readonly skipActivePairs?: boolean;
	readonly triggerActiveCollisionPower?: boolean;
}

export class CurlingPowerRuntime {
	constructor(
		private readonly registry: PowerRegistry,
		private readonly nextStoneId: () => number,
	) {}

	applyPower(
		power: PowerType,
		stone: StoneState,
		arena: RectArenaPixels,
	): void {
		stone.power = power;
		this.registry.get(power).onApply(stone, arena);
	}

	stepStone(
		stone: StoneState,
		delta: number,
		arena: RectArenaPixels,
	): boolean {
		return stepCurlingStone(stone, delta, arena);
	}

	updatePower(
		stone: StoneState,
		delta: number,
		arena: RectArenaPixels,
	): void {
		this.registry.get(stone.power).onUpdate?.(stone, delta, arena);
	}

	collidePower(
		stone: StoneState,
		other: StoneState,
		arena: RectArenaPixels,
	): void {
		this.registry.get(stone.power).onCollide?.(stone, other, arena);
	}

	stopPower(
		stone: StoneState,
		arena: RectArenaPixels,
		allStones: StoneState[],
	): void {
		this.registry.get(stone.power).onStop?.(stone, arena, allStones);
	}

	resolveCollisions(
		stones: readonly StoneState[],
		arena: RectArenaPixels,
		options: CurlingCollisionOptions = {},
	): void {
		const active = options.activeStone ?? null;
		for (let i = 0; i < stones.length; i++) {
			for (let j = i + 1; j < stones.length; j++) {
				const a = stones[i];
				const b = stones[j];
				const includesActive = active === a || active === b;
				if (options.skipActivePairs && includesActive) continue;
				if (this.isPhantomHidden(a) || this.isPhantomHidden(b))
					continue;

				const colliding =
					Boolean(
						active &&
						options.triggerActiveCollisionPower &&
						includesActive,
					) && this.stonesOverlapping(a, b);
				resolveStoneCollision(a, b);
				if (colliding && active)
					this.collidePower(active, active === a ? b : a, arena);
			}
		}
	}

	consumeSpawnRequests(
		stone: StoneState,
		arena: RectArenaPixels,
	): CurlingPowerSpawnResult {
		const children: StoneState[] = [];
		let split = false;
		let mirror = false;
		let removeSource = false;

		if (stone.splitterPending) {
			stone.splitterPending = false;
			children.push(...this.createSplitStones(stone));
			split = true;
			removeSource = true;
		}
		if (stone.mirrorPending) {
			stone.mirrorPending = false;
			children.push(this.createMirrorStone(stone, arena));
			mirror = true;
		}

		return { children, split, mirror, removeSource };
	}

	private createSplitStones(parent: StoneState): StoneState[] {
		const parentSpeed = Math.hypot(parent.vx, parent.vy);
		const parentAngle = Math.atan2(parent.vy, parent.vx);
		const childRadius = parent.r * SPLITTER_RADIUS;
		const spawnOffset = Math.max(1, childRadius * 0.45);

		return [-SPLITTER_SPREAD, 0, SPLITTER_SPREAD].map((offset) => {
			const angle = parentAngle + offset;
			return {
				id: this.nextStoneId(),
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

	private createMirrorStone(
		parent: StoneState,
		arena: RectArenaPixels,
	): StoneState {
		const mirroredY =
			arena.sheetY + arena.sheetH - (parent.y - arena.sheetY);
		return {
			id: this.nextStoneId(),
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

	private isPhantomHidden(stone: StoneState): boolean {
		return Boolean((stone as { phantomHidden?: boolean }).phantomHidden);
	}

	private stonesOverlapping(a: StoneState, b: StoneState): boolean {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return Math.hypot(dx, dy) < a.r + b.r;
	}
}
