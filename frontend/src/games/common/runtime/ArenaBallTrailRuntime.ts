import type Phaser from "phaser";

import type { ArenaPixels } from "../../../shared/arenas/arena";
import type { RectArenaPixels } from "../../../shared/mechanics/rect-arena";
import type { BallState } from "../../../shared/mechanics/ball";
import type { ArenaPowerBallEntry } from "../../../shared/mechanics/arena-power-runtime";
import {
	drawPlayerTrails,
	recordPlayerTrails,
	resetPlayerTrail,
	type PlayerTrailObject,
	type PlayerTrailOptions,
	type PlayerTrailPoint,
	type PlayerTrailStore,
} from "../../../shared/mechanics/player-trails";

export type ArenaBallTrailId = number | string;

export const DEFAULT_TRAIL_EFFECT = "trail_classic";

export interface ArenaBallTrailObject {
	readonly id: ArenaBallTrailId;
	readonly player: number;
	readonly ball: BallState;
	readonly trailEffect?: string;
}

export type ArenaBallMovingResolver = (ball: BallState) => boolean;

export interface ArenaBallTrailSetOptions {
	readonly balls: readonly ArenaBallTrailObject[];
	readonly powerBalls?: Iterable<ArenaPowerBallEntry>;
	readonly isMoving: ArenaBallMovingResolver;
	readonly trailOptions?: PlayerTrailOptions;
	readonly trailEffectByPlayer?: (player: number) => string;
}

export function buildArenaBallTrailObjects(
	objects: readonly ArenaBallTrailObject[],
	isMoving: ArenaBallMovingResolver,
): PlayerTrailObject[] {
	return objects.map(({ id, player, ball, trailEffect }) => ({
		id,
		player,
		x: ball.x,
		y: ball.y,
		moving: isMoving(ball),
		trailEffect,
	}));
}

export function buildArenaPowerBallTrailObjects(
	entries: Iterable<ArenaPowerBallEntry>,
	isMoving: ArenaBallMovingResolver,
	keyPrefix = "power",
): PlayerTrailObject[] {
	return Array.from(entries, (entry, index) => ({
		id: `${keyPrefix}-${index}`,
		player: entry.player,
		x: entry.ball.x,
		y: entry.ball.y,
		moving: isMoving(entry.ball),
	}));
}

export function resolvePlayerTrailEffects(
	trailEffects: Record<string, string | undefined> | undefined,
	fallback: readonly string[] = [],
	playerCount = 5,
): string[] {
	return Array.from(
		{ length: playerCount },
		(_value, index) =>
			trailEffects?.[`player${index}`] ??
			fallback[index] ??
			DEFAULT_TRAIL_EFFECT,
	);
}

export class ArenaBallTrailRuntime {
	private readonly store: PlayerTrailStore = new Map();
	private readonly trailEffectsById = new Map<ArenaBallTrailId, string>();
	private readonly movingIds = new Set<ArenaBallTrailId>();

	clear(): void {
		this.store.clear();
		this.trailEffectsById.clear();
		this.movingIds.clear();
	}

	get(id: ArenaBallTrailId): PlayerTrailPoint[] | undefined {
		return this.store.get(id);
	}

	set(id: ArenaBallTrailId, trail: PlayerTrailPoint[]): void {
		this.store.set(id, trail);
	}

	delete(id: ArenaBallTrailId): boolean {
		this.trailEffectsById.delete(id);
		this.movingIds.delete(id);
		return this.store.delete(id);
	}

	entries(): IterableIterator<[ArenaBallTrailId, PlayerTrailPoint[]]> {
		return this.store.entries();
	}

	reset(id: ArenaBallTrailId, x: number, y: number): void {
		resetPlayerTrail(this.store, id, x, y);
		this.movingIds.delete(id);
	}

	record(
		objects: readonly PlayerTrailObject[],
		options: PlayerTrailOptions = {},
	): void {
		for (const object of objects) {
			if (object.trailEffect)
				this.trailEffectsById.set(object.id, object.trailEffect);
			if (object.moving) this.movingIds.add(object.id);
			else this.movingIds.delete(object.id);
		}
		recordPlayerTrails(this.store, objects, options);
	}

	recordSet(options: ArenaBallTrailSetOptions): void {
		const objects = [
			...buildArenaBallTrailObjects(options.balls, options.isMoving),
			...buildArenaPowerBallTrailObjects(
				options.powerBalls ?? [],
				options.isMoving,
			),
		].map((object) => ({
			...object,
			trailEffect:
				object.trailEffect ?? options.trailEffectByPlayer?.(object.player),
		}));
		this.record(objects, options.trailOptions);
	}

	draw(
		gfx: Phaser.GameObjects.Graphics,
		playersById: ReadonlyMap<ArenaBallTrailId, number>,
		options: PlayerTrailOptions = {},
	): void {
		drawPlayerTrails(gfx, this.store, playersById, {
			...options,
			trailEffectsById: this.trailEffectsById,
			movingIds: this.movingIds,
		});
	}

	readNormalisedTrail(
		id: ArenaBallTrailId,
		arena: ArenaPixels,
	): Array<{ x: number; y: number }> {
		const trail = this.store.get(id);
		if (!trail?.length) return [];
		return trail.map((point) => ({
			x: (point.x - arena.cx) / arena.rx,
			y: (point.y - arena.cy) / arena.ry,
		}));
	}

	readRectNormalisedTrail(
		id: ArenaBallTrailId,
		arena: RectArenaPixels,
		options: { readonly clamp?: boolean } = {},
	): Array<{ x: number; y: number }> {
		const trail = this.store.get(id);
		if (!trail?.length) return [];
		const normalise = (value: number) =>
			options.clamp ? Math.max(0, Math.min(1, value)) : value;
		return trail.map((point) => ({
			x: normalise((point.x - arena.sheetX) / arena.sheetW),
			y: normalise((point.y - arena.sheetY) / arena.sheetH),
		}));
	}
}
