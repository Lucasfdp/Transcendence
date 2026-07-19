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
const TRAIL_SOFT_TEXTURE = "shellsmash-trail-soft";
const TRAIL_RING_TEXTURE = "shellsmash-trail-ring";
const TRAIL_SPARK_TEXTURE = "shellsmash-trail-spark";
let trailLayerSequence = 0;

export interface PlayerTrailStamp {
	readonly texture: "soft" | "ring" | "spark";
	readonly x: number;
	readonly y: number;
	readonly tint: number;
	readonly alpha: number;
	readonly scale: number;
}

interface PlayerTrailTextureLayer {
	readonly key: string;
	readonly texture: Phaser.Textures.DynamicTexture;
	readonly image: Phaser.GameObjects.Image;
	signature: string;
}

const trailTextureLayers = new WeakMap<
	Phaser.GameObjects.Graphics,
	PlayerTrailTextureLayer
>();

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
		if (
			!last ||
			Math.hypot(object.x - last.x, object.y - last.y) >= minDistance
		) {
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
	if (drawTexturedPlayerTrails(gfx, store, playersById, options)) return;
	for (const [id, trail] of store) {
		const player = playersById.get(id) ?? 0;
		const colour =
			PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		drawClassicPlayerTrail(gfx, trail, colour, options);
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

export function buildPlayerTrailStamps(
	positions: readonly PlayerTrailPoint[],
	colour: number,
	effect: string,
	options: ClassicPlayerTrailOptions = {},
): PlayerTrailStamp[] {
	if (positions.length < 2) return [];
	const resolvedEffect = [
		"trail_classic",
		"trail_comet",
		"trail_spark",
		"trail_ghost",
		"trail_ripple",
	].includes(effect)
		? effect
		: "trail_classic";
	const scale = options.scale ?? 1;
	const lineWidth = Math.max(
		2,
		(options.lineWidth ?? DEFAULT_LINE_WIDTH) * scale,
	);
	const baseScale = lineWidth / 32;
	const recent = positions.slice(-32);
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

function drawTexturedPlayerTrails(
	gfx: Phaser.GameObjects.Graphics,
	store: PlayerTrailStore,
	playersById: ReadonlyMap<number | string, number>,
	options: PlayerTrailOptions,
): boolean {
	const scene = gfx.scene;
	if (!scene?.textures?.addDynamicTexture) return false;
	ensureTrailStampTextures(scene);
	const width = Math.max(2, Math.ceil(scene.scale.width));
	const height = Math.max(2, Math.ceil(scene.scale.height));
	let layer = trailTextureLayers.get(gfx);
	if (!layer || !layer.image.active) {
		const key = `shellsmash-trail-layer-${++trailLayerSequence}`;
		const texture = scene.textures.addDynamicTexture(key, width, height);
		if (!texture) return false;
		const image = scene.add
			.image(0, 0, key)
			.setOrigin(0)
			.setDepth(gfx.depth + 0.01);
		layer = { key, texture, image, signature: "" };
		trailTextureLayers.set(gfx, layer);
		scene.events.once("shutdown", () => {
			if (layer?.image.active) layer.image.destroy();
			if (scene.textures.exists(key)) scene.textures.remove(key);
			trailTextureLayers.delete(gfx);
		});
	}
	if (layer.texture.width !== width || layer.texture.height !== height) {
		layer.texture.setSize(width, height);
		layer.image.setDisplaySize(width, height);
		layer.signature = "";
	}
	layer.image.setDepth(gfx.depth + 0.01);
	const signature = trailTextureSignature(store, options, width, height);
	if (signature === layer.signature) return true;
	layer.signature = signature;
	layer.texture.clear();
	let drewStamp = false;
	for (const [id, trail] of store) {
		const player = playersById.get(id) ?? 0;
		const colour =
			PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length];
		const effect = options.trailEffectsById?.get(id) ?? "trail_classic";
		for (const stamp of buildPlayerTrailStamps(
			trail,
			colour,
			effect,
			options,
		)) {
			layer.texture.stamp(
				trailStampTextureKey(stamp.texture),
				undefined,
				stamp.x,
				stamp.y,
				{
					alpha: stamp.alpha,
					tint: stamp.tint,
					scale: stamp.scale,
				},
			);
			drewStamp = true;
		}
	}
	layer.image.setVisible(drewStamp);
	return true;
}

function trailTextureSignature(
	store: PlayerTrailStore,
	options: PlayerTrailOptions,
	width: number,
	height: number,
): string {
	const parts = [`${width}x${height}`, String(options.scale ?? 1)];
	for (const [id, trail] of store) {
		const first = trail[0];
		const last = trail[trail.length - 1];
		parts.push(
			String(id),
			String(trail.length),
			`${first?.x ?? 0},${first?.y ?? 0}`,
			`${last?.x ?? 0},${last?.y ?? 0}`,
			options.trailEffectsById?.get(id) ?? "trail_classic",
		);
	}
	return parts.join("|");
}

function trailStampTextureKey(texture: PlayerTrailStamp["texture"]): string {
	if (texture === "ring") return TRAIL_RING_TEXTURE;
	if (texture === "spark") return TRAIL_SPARK_TEXTURE;
	return TRAIL_SOFT_TEXTURE;
}

function ensureTrailStampTextures(scene: Phaser.Scene): void {
	if (
		scene.textures.exists(TRAIL_SOFT_TEXTURE) &&
		scene.textures.exists(TRAIL_RING_TEXTURE) &&
		scene.textures.exists(TRAIL_SPARK_TEXTURE)
	)
		return;
	const gfx = scene.add.graphics().setVisible(false);
	if (!scene.textures.exists(TRAIL_SOFT_TEXTURE)) {
		gfx.clear().fillStyle(0xffffff, 1).fillCircle(16, 16, 15);
		gfx.generateTexture(TRAIL_SOFT_TEXTURE, 32, 32);
	}
	if (!scene.textures.exists(TRAIL_RING_TEXTURE)) {
		gfx.clear().lineStyle(4, 0xffffff, 1).strokeCircle(16, 16, 12);
		gfx.generateTexture(TRAIL_RING_TEXTURE, 32, 32);
	}
	if (!scene.textures.exists(TRAIL_SPARK_TEXTURE)) {
		gfx.clear()
			.lineStyle(4, 0xffffff, 1)
			.lineBetween(16, 2, 16, 30)
			.lineBetween(2, 16, 30, 16)
			.lineStyle(2, 0xffffff, 0.85)
			.lineBetween(6, 6, 26, 26)
			.lineBetween(26, 6, 6, 26);
		gfx.generateTexture(TRAIL_SPARK_TEXTURE, 32, 32);
	}
	gfx.destroy();
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
