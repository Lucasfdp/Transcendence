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
	// Opt-in fade for stopped balls: when > 0, each record call removes this
	// many points from the oldest end of a stopped ball's trail. Balls absent
	// from the record call are never touched, so archived trails persist.
	readonly stoppedFadePointsPerRecord?: number;
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

// Only the most recent points are rendered, matching the retired stamp
// textures' window so the polyline path stays visually identical.
const RECENT_POINT_LIMIT = 32;

const TRAIL_EFFECT_IDS = [
	"trail_classic",
	"trail_comet",
	"trail_spark",
	"trail_ghost",
	"trail_ripple",
];

function resolveTrailEffectId(effect: string): string {
	return TRAIL_EFFECT_IDS.includes(effect) ? effect : "trail_classic";
}

export interface PlayerTrailStamp {
	readonly texture: "soft" | "ring" | "spark";
	readonly x: number;
	readonly y: number;
	readonly tint: number;
	readonly alpha: number;
	readonly scale: number;
}

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
	const stoppedFade = options.stoppedFadePointsPerRecord ?? 0;

	for (const object of objects) {
		if (!object.moving) {
			// Stopped balls optionally shed their oldest points so a settled
			// field stops accumulating draw commands frame after frame.
			if (stoppedFade > 0) {
				const trail = store.get(object.id);
				if (!trail) continue;
				trail.splice(0, stoppedFade);
				if (trail.length === 0) store.delete(object.id);
			}
			continue;
		}
		let trail = store.get(object.id);
		if (!trail) {
			trail = [];
			store.set(object.id, trail);
		}
		const last = trail[trail.length - 1];
		if (
			!last ||
			Math.hypot(object.x - last.x, object.y - last.y) >= minDistance
		) {
			// Mutate in place: trimming with splice avoids allocating a fresh
			// array copy for every recorded point.
			trail.push({ x: object.x, y: object.y });
			if (maxPoints > 0 && trail.length > maxPoints)
				trail.splice(0, trail.length - maxPoints);
		}
	}
}

// Trails are drawn immediately onto the supplied Graphics object every call,
// exactly like the balls and arena borders. An earlier implementation cached
// stamps in a DynamicTexture layer, which drifted out of sync with the scene
// on resize/zoom relayouts.
export function drawPlayerTrails(
	gfx: Phaser.GameObjects.Graphics,
	store: PlayerTrailStore,
	playersById: ReadonlyMap<number | string, number>,
	options: PlayerTrailOptions = {},
): void {
	gfx.clear();
	for (const [id, trail] of store) {
		const player = playersById.get(id) ?? 0;
		const colour =
			PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		const effect = options.trailEffectsById?.get(id) ?? "trail_classic";
		if (resolveTrailEffectId(effect) === "trail_classic") {
			// The classic trail renders as polyline segments (~31 commands per
			// ball) instead of hundreds of tessellated circle stamps; the old
			// "soft" stamp was a flat filled circle, so visuals are identical.
			drawClassicPlayerTrail(
				gfx,
				trail,
				colour,
				options,
				Math.max(1, trail.length - RECENT_POINT_LIMIT + 1),
			);
			continue;
		}
		for (const stamp of buildPlayerTrailStamps(
			trail,
			colour,
			effect,
			options,
		))
			drawPlayerTrailStamp(gfx, stamp);
	}
}

// Mirrors the shapes of the retired 32x32 stamp textures: a filled circle
// (radius 15 at 16,16), a stroked ring (radius 12, width 4) and a spark cross.
function drawPlayerTrailStamp(
	gfx: Phaser.GameObjects.Graphics,
	stamp: PlayerTrailStamp,
): void {
	const { x, y, tint, alpha, scale } = stamp;
	if (stamp.texture === "soft") {
		gfx.fillStyle(tint, alpha).fillCircle(x, y, 15 * scale);
		return;
	}
	if (stamp.texture === "ring") {
		gfx.lineStyle(4 * scale, tint, alpha).strokeCircle(x, y, 12 * scale);
		return;
	}
	gfx.lineStyle(4 * scale, tint, alpha)
		.lineBetween(x, y - 14 * scale, x, y + 14 * scale)
		.lineBetween(x - 14 * scale, y, x + 14 * scale, y)
		.lineStyle(2 * scale, tint, alpha * 0.85)
		.lineBetween(x - 10 * scale, y - 10 * scale, x + 10 * scale, y + 10 * scale)
		.lineBetween(x + 10 * scale, y - 10 * scale, x - 10 * scale, y + 10 * scale);
}

export function drawClassicPlayerTrail(
	gfx: Phaser.GameObjects.Graphics,
	positions: readonly PlayerTrailPoint[],
	colour: number,
	options: ClassicPlayerTrailOptions = {},
	startIndex = 1,
): void {
	if (positions.length < 2) return;
	const scale = options.scale ?? 1;
	const lineWidth = Math.max(
		2,
		(options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale,
	);
	const baseAlpha = options.baseAlpha ?? DEFAULT_BASE_ALPHA;
	const alphaRange = options.alphaRange ?? DEFAULT_ALPHA_RANGE;

	for (let index = Math.max(1, startIndex); index < positions.length; index++) {
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

export function buildPlayerTrailStamps(
	positions: readonly PlayerTrailPoint[],
	colour: number,
	effect: string,
	options: ClassicPlayerTrailOptions = {},
): PlayerTrailStamp[] {
	if (positions.length < 2) return [];
	const resolvedEffect = resolveTrailEffectId(effect);
	const scale = options.scale ?? 1;
	const lineWidth = Math.max(
		2,
		(options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale,
	);
	const baseScale = lineWidth / 32;
	const recent = positions.slice(-RECENT_POINT_LIMIT);
	const stamps: PlayerTrailStamp[] = [];
	if (resolvedEffect === "trail_classic") {
		const spacing = Math.max(2, lineWidth * 0.72);
		for (let index = 1; index < recent.length; index++) {
			const from = recent[index - 1];
			const to = recent[index];
			const distance = Math.hypot(to.x - from.x, to.y - from.y);
			const steps = Math.max(1, Math.ceil(distance / spacing));
			for (let step = 1; step <= steps; step++) {
				const progress = step / steps;
				stamps.push({
					texture: "soft",
					x: from.x + (to.x - from.x) * progress,
					y: from.y + (to.y - from.y) * progress,
					tint: colour,
					alpha:
						(options.baseAlpha ?? DEFAULT_BASE_ALPHA) +
						(index / recent.length) *
							(options.alphaRange ?? DEFAULT_ALPHA_RANGE),
					scale: baseScale,
				});
			}
		}
		return stamps;
	}

	for (let index = 1; index < recent.length; index++) {
		const point = recent[index];
		const progress = index / recent.length;
		if (resolvedEffect === "trail_comet") {
			stamps.push({
				texture: "soft",
				x: point.x,
				y: point.y,
				tint: index === recent.length - 1 ? 0xfff7cf : colour,
				alpha: 0.1 + progress * 0.58,
				scale: baseScale * (2.8 - progress * 1.35),
			});
			continue;
		}
		if (resolvedEffect === "trail_spark" && index % 2 === 0) {
			const offset = offsetTrailPoint(
				recent,
				index,
				((index % 4) - 1.5) * 5.2 * scale,
			);
			stamps.push({
				texture: "spark",
				x: offset.x,
				y: offset.y,
				tint: index % 4 === 0 ? 0xfff2a6 : 0xffb84f,
				alpha: 0.35 + progress * 0.5,
				scale: baseScale * (1.8 + progress),
			});
			continue;
		}
		if (resolvedEffect === "trail_ghost" && index % 3 === 0) {
			stamps.push({
				texture: "ring",
				x: point.x,
				y: point.y,
				tint: 0xe8f4ff,
				alpha: 0.14 + progress * 0.3,
				scale: baseScale * (2.7 + progress * 1.8),
			});
			continue;
		}
		if (resolvedEffect === "trail_ripple" && index % 3 === 0) {
			stamps.push({
				texture: "ring",
				x: point.x,
				y: point.y,
				tint: index % 2 === 0 ? 0x9ff3e8 : 0xeafffb,
				alpha: 0.12 + progress * 0.32,
				scale: baseScale * (2.5 + (recent.length - index) * 0.12),
			});
		}
	}
	return stamps;
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
