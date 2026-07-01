import Phaser from "phaser";

import { PLAYER_COLOUR_VALUES } from "../game-ui";

export interface PlayerTrailPoint {
	x: number;
	y: number;
}

export interface PlayerTrailObject {
	id: number | string;
	player: number;
	x: number;
	y: number;
	moving: boolean;
}

export type PlayerTrailStore = Map<number | string, PlayerTrailPoint[]>;

export interface PlayerTrailOptions {
	readonly scale?: number;
	readonly maxPoints?: number;
	readonly minDistance?: number;
	readonly lineWidth?: number;
	readonly baseAlpha?: number;
	readonly alphaRange?: number;
}

const DEFAULT_MAX_POINTS = 80;
const DEFAULT_MIN_DISTANCE = 8;
const DEFAULT_LINE_WIDTH = 4;
const DEFAULT_BASE_ALPHA = 0.1;
const DEFAULT_ALPHA_RANGE = 0.38;

export function resetPlayerTrail(
	store: PlayerTrailStore,
	id: number | string,
	x: number,
	y: number,
): void {
	store.set(id, [{ x, y }]);
}

export function recordPlayerTrails(
	store: PlayerTrailStore,
	objects: readonly PlayerTrailObject[],
	options: PlayerTrailOptions = {},
): void {
	const scale = options.scale ?? 1;
	const minDistance = (options.minDistance ?? DEFAULT_MIN_DISTANCE) * scale;
	const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;

	for (const object of objects) {
		if (!object.moving) continue;
		const trail = store.get(object.id) ?? [];
		const last = trail[trail.length - 1];
		if (!last || Math.hypot(object.x - last.x, object.y - last.y) >= minDistance) {
			trail.push({ x: object.x, y: object.y });
			store.set(object.id, trail.slice(-maxPoints));
		}
	}
}

export function drawPlayerTrails(
	gfx: Phaser.GameObjects.Graphics,
	store: PlayerTrailStore,
	playersById: ReadonlyMap<number | string, number>,
	options: PlayerTrailOptions = {},
): void {
	gfx.clear();
	const scale = options.scale ?? 1;
	const lineWidth = Math.max(2, (options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale);
	const baseAlpha = options.baseAlpha ?? DEFAULT_BASE_ALPHA;
	const alphaRange = options.alphaRange ?? DEFAULT_ALPHA_RANGE;

	for (const [id, trail] of store) {
		if (trail.length < 2) continue;
		const player = playersById.get(id) ?? 0;
		const colour = PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		for (let i = 1; i < trail.length; i++) {
			const alpha = baseAlpha + (i / trail.length) * alphaRange;
			gfx.lineStyle(lineWidth, colour, alpha);
			gfx.lineBetween(
				trail[i - 1].x,
				trail[i - 1].y,
				trail[i].x,
				trail[i].y,
			);
		}
	}
}
