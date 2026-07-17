import type Phaser from "phaser";

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
	trailEffect?: string;
}

export type PlayerTrailStore = Map<number | string, PlayerTrailPoint[]>;

export interface PlayerTrailOptions {
	readonly scale?: number;
	readonly maxPoints?: number;
	readonly minDistance?: number;
	readonly lineWidth?: number;
	readonly baseAlpha?: number;
	readonly alphaRange?: number;
	readonly trailEffectsById?: ReadonlyMap<number | string, string>;
	readonly movingIds?: ReadonlySet<number | string>;
}

export type ClassicPlayerTrailOptions = Pick<
	PlayerTrailOptions,
	"scale" | "lineWidth" | "baseAlpha" | "alphaRange"
>;

const DEFAULT_MAX_POINTS = 80;
const DEFAULT_MIN_DISTANCE = 8;
const DEFAULT_LINE_WIDTH = 4;
const DEFAULT_BASE_ALPHA = 0.1;
const DEFAULT_ALPHA_RANGE = 0.38;
const ENABLE_ADVANCED_TRAIL_EFFECTS = false;

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

	for (const [id, trail] of store) {
		const player = playersById.get(id) ?? 0;
		const colour = PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		drawClassicPlayerTrail(gfx, trail, colour, options);
	}

	const lineWidth = Math.max(
		2,
		(options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale,
	);

	if (
		!ENABLE_ADVANCED_TRAIL_EFFECTS ||
		!options.trailEffectsById ||
		!options.movingIds
	)
		return;
	for (const [id, trail] of store) {
		if (trail.length < 2 || !options.movingIds.has(id)) continue;
		const effect = options.trailEffectsById.get(id) ?? "trail_classic";
		if (effect === "trail_classic") continue;
		const player = playersById.get(id) ?? 0;
		const colour = PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		drawLiveTrailEffect(gfx, trail, colour, effect, lineWidth, scale);
	}
}

export function drawClassicPlayerTrail(
	gfx: Phaser.GameObjects.Graphics,
	positions: readonly PlayerTrailPoint[],
	colour: number,
	options: ClassicPlayerTrailOptions = {},
): void {
	if (positions.length < 2) return;
	const scale = options.scale ?? 1;
	const lineWidth = Math.max(
		2,
		(options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale,
	);
	const baseAlpha = options.baseAlpha ?? DEFAULT_BASE_ALPHA;
	const alphaRange = options.alphaRange ?? DEFAULT_ALPHA_RANGE;

	for (let index = 1; index < positions.length; index++) {
		const alpha = baseAlpha + (index / positions.length) * alphaRange;
		gfx.lineStyle(lineWidth, colour, alpha);
		gfx.lineBetween(
			positions[index - 1].x,
			positions[index - 1].y,
			positions[index].x,
			positions[index].y,
		);
	}
}

function drawLiveTrailEffect(
	gfx: Phaser.GameObjects.Graphics,
	trail: PlayerTrailPoint[],
	colour: number,
	effect: string,
	lineWidth: number,
	scale: number,
): void {
	const recent = trail.slice(-24);
	if (recent.length < 2) return;
	if (effect === "trail_comet") {
		for (let i = 1; i < recent.length; i++) {
			const alpha = 0.1 + (i / recent.length) * 0.28;
			gfx.lineStyle(lineWidth * 3.3, colour, alpha * 0.42);
			gfx.lineBetween(
				recent[i - 1].x,
				recent[i - 1].y,
				recent[i].x,
				recent[i].y,
			);
			gfx.lineStyle(lineWidth * 1.55, colour, alpha * 0.72);
			gfx.lineBetween(
				recent[i - 1].x,
				recent[i - 1].y,
				recent[i].x,
				recent[i].y,
			);
			gfx.lineStyle(Math.max(2.5, lineWidth * 0.6), 0xfff7cf, alpha + 0.18);
			gfx.lineBetween(
				recent[i - 1].x,
				recent[i - 1].y,
				recent[i].x,
				recent[i].y,
			);
		}
		drawTrailTipFlare(gfx, recent, colour, scale, 0xfff7cf);
		return;
	}

	if (effect === "trail_spark") {
		drawRecentGlowLine(gfx, recent, colour, lineWidth * 1.6, 0.2);
		for (let i = Math.max(1, recent.length - 18); i < recent.length; i += 2) {
			const point = offsetTrailPoint(recent, i, ((i % 4) - 1.5) * 5.2 * scale);
			const r = (2.8 + (i / recent.length) * 3.8) * scale;
			gfx.fillStyle(i % 2 === 0 ? 0xfff2a6 : 0xffb84f, 0.78);
			gfx.fillCircle(point.x, point.y, r);
			gfx.fillStyle(0xffffff, 0.7);
			gfx.fillCircle(point.x, point.y, Math.max(1.4, r * 0.34));
		}
		drawTrailTipFlare(gfx, recent, 0xffc95d, scale, 0xffffff);
		return;
	}

	if (effect === "trail_ghost") {
		drawRecentGlowLine(gfx, recent, colour, lineWidth * 1.4, 0.16);
		for (let i = Math.max(1, recent.length - 18); i < recent.length; i += 3) {
			const point = recent[i];
			const alpha = 0.18 + (i / recent.length) * 0.24;
			const r = (7.2 + (i / recent.length) * 6.2) * scale;
			gfx.fillStyle(0xe8f4ff, alpha * 0.32);
			gfx.fillCircle(point.x, point.y, r);
			gfx.lineStyle(Math.max(1.6, 2.6 * scale), 0xe8f4ff, alpha);
			gfx.strokeCircle(point.x, point.y, r);
		}
		drawTrailTipFlare(gfx, recent, 0xb8d8ff, scale, 0xffffff);
		return;
	}

	if (effect === "trail_ripple") {
		drawRecentGlowLine(gfx, recent, colour, lineWidth * 1.4, 0.16);
		for (let i = Math.max(1, recent.length - 20); i < recent.length; i += 3) {
			const point = recent[i];
			const alpha = 0.16 + (i / recent.length) * 0.24;
			const r = (7.5 + (recent.length - i) * 0.75) * scale;
			gfx.lineStyle(Math.max(1.4, 2.3 * scale), 0x9ff3e8, alpha);
			gfx.strokeCircle(point.x, point.y, r);
			gfx.lineStyle(Math.max(1, 1.2 * scale), 0xeafffb, alpha * 0.58);
			gfx.strokeCircle(point.x, point.y, r * 0.58);
		}
		drawTrailTipFlare(gfx, recent, 0x67d5d0, scale, 0xeafffb);
	}
}

function drawRecentGlowLine(
	gfx: Phaser.GameObjects.Graphics,
	recent: PlayerTrailPoint[],
	colour: number,
	lineWidth: number,
	alpha: number,
): void {
	for (let i = 1; i < recent.length; i++) {
		gfx.lineStyle(lineWidth, colour, alpha * (i / recent.length));
		gfx.lineBetween(recent[i - 1].x, recent[i - 1].y, recent[i].x, recent[i].y);
	}
}

function drawTrailTipFlare(
	gfx: Phaser.GameObjects.Graphics,
	recent: PlayerTrailPoint[],
	colour: number,
	scale: number,
	core: number,
): void {
	const point = recent[recent.length - 1];
	const r = 8 * scale;
	gfx.fillStyle(colour, 0.34);
	gfx.fillCircle(point.x, point.y, r * 1.75);
	gfx.fillStyle(core, 0.82);
	gfx.fillCircle(point.x, point.y, r * 0.62);
}

function offsetTrailPoint(
	recent: PlayerTrailPoint[],
	index: number,
	offset: number,
): PlayerTrailPoint {
	const previous = recent[Math.max(0, index - 1)];
	const next = recent[Math.min(recent.length - 1, index + 1)];
	const dx = next.x - previous.x;
	const dy = next.y - previous.y;
	const length = Math.hypot(dx, dy) || 1;
	return {
		x: recent[index].x + (-dy / length) * offset,
		y: recent[index].y + (dx / length) * offset,
	};
}
