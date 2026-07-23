import Phaser from "phaser";
import { INGAME_PLAYER_ASSET, SHELL_SKIN_ASSETS, resolveShellSkinAsset } from "../assets";

interface PlayerVisualState {
	x: number;
	y: number;
	r: number;
	vx?: number;
	vy?: number;
	alpha?: number;
}

interface PlayerRollState {
	x: number;
	y: number;
}

interface PlayerRenderOptions {
	initialRotation?: number;
}

const rollStates = new WeakMap<Phaser.GameObjects.Image, PlayerRollState>();

// Per-scene cache of resolved player images so steady-state frames avoid
// linear display-list scans. A `null` entry records a confirmed miss; misses
// are purged on the hide/destroy paths, the only windows in which scenes
// create fallback images, so external creations are always re-discovered.
const playerImageCaches = new WeakMap<
	Phaser.Scene,
	Map<string, Phaser.GameObjects.Image | null>
>();

function getPlayerImageCache(
	scene: Phaser.Scene,
): Map<string, Phaser.GameObjects.Image | null> {
	let cache = playerImageCaches.get(scene);
	if (!cache) {
		cache = new Map();
		playerImageCaches.set(scene, cache);
	}
	return cache;
}

function findPlayerImage(
	scene: Phaser.Scene,
	name: string,
): Phaser.GameObjects.Image | undefined {
	const cache = getPlayerImageCache(scene);
	const cached = cache.get(name);
	if (cached === null) return undefined;
	if (cached) {
		if (cached.active) return cached;
		cache.delete(name);
	}
	const existing = scene.children.getByName(name);
	if (existing instanceof Phaser.GameObjects.Image) {
		cache.set(name, existing);
		return existing;
	}
	cache.set(name, null);
	return undefined;
}

// Drop cached entries so the next lookup rescans the display list. Called on
// hide/destroy paths, after which scenes may create or remove fallbacks.
function purgePlayerImageCache(scene: Phaser.Scene, names: string[]): void {
	const cache = playerImageCaches.get(scene);
	if (!cache) return;
	for (const name of names) cache.delete(name);
}

const TELEPORT_DISTANCE_MIN = 180;
const TELEPORT_DISTANCE_RADIUS_FACTOR = 8;
const RETRACT_SPEED_MIN = 2;

export function preloadIngamePlayerTexture(scene: Phaser.Scene): void {
	if (!scene.textures.exists(INGAME_PLAYER_ASSET.bodyKey))
		scene.load.image(
			INGAME_PLAYER_ASSET.bodyKey,
			INGAME_PLAYER_ASSET.bodySource,
		);
	for (const asset of Object.values(SHELL_SKIN_ASSETS)) {
		if (!scene.textures.exists(asset.key)) scene.load.image(asset.key, asset.source);
	}
}

export function drawIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
	state: PlayerVisualState,
	depth: number,
	shellSkin?: string | null,
	options: PlayerRenderOptions = {},
): boolean {
	const shellAsset = resolveShellSkinAsset(shellSkin);
	if (
		!scene.textures.exists(INGAME_PLAYER_ASSET.bodyKey) ||
		!scene.textures.exists(shellAsset.key)
	) {
		hideIngamePlayerTexture(scene, name);
		return false;
	}

	const body = getOrCreatePlayerImage(
		scene,
		`${name}-body`,
		INGAME_PLAYER_ASSET.bodyKey,
		state,
	);
	const shell = getOrCreatePlayerImage(
		scene,
		`${name}-shell`,
		shellAsset.key,
		state,
	);
	hideFallbackTexture(scene, name);
	if (shell.texture.key !== shellAsset.key) shell.setTexture(shellAsset.key);
	updateIngamePlayerRoll(shell, state, options.initialRotation);

	const isRetracted = isPlayerMoving(state);
	body
		.setVisible(!isRetracted)
		.setPosition(state.x, state.y)
		.setDepth(depth)
		.setRotation(shell.rotation)
		.setDisplaySize(state.r * 2, state.r * 2)
		.setAlpha(state.alpha ?? 1);

	shell
		.setVisible(true)
		.setPosition(state.x, state.y)
		.setDepth(depth + 0.01)
		.setRotation(shell.rotation)
		.setDisplaySize(state.r * 2, state.r * 2)
		.setAlpha(state.alpha ?? 1);
	return true;
}

export function drawIngameShellTexture(
	scene: Phaser.Scene,
	name: string,
	state: PlayerVisualState,
	depth: number,
	shellSkin?: string | null,
	options: PlayerRenderOptions = {},
): boolean {
	const shellAsset = resolveShellSkinAsset(shellSkin);
	if (!scene.textures.exists(shellAsset.key)) {
		hideIngamePlayerTexture(scene, name);
		return false;
	}

	const body = findPlayerImage(scene, `${name}-body`);
	if (body) body.setVisible(false);

	const shell = getOrCreatePlayerImage(
		scene,
		`${name}-shell`,
		shellAsset.key,
		state,
	);
	hideFallbackTexture(scene, name);
	if (shell.texture.key !== shellAsset.key) shell.setTexture(shellAsset.key);
	updateIngamePlayerRoll(shell, state, options.initialRotation);

	shell
		.setVisible(true)
		.setPosition(state.x, state.y)
		.setDepth(depth + 0.01)
		.setRotation(shell.rotation)
		.setDisplaySize(state.r * 2.35, state.r * 2.35)
		.setAlpha(state.alpha ?? 1);
	return true;
}

function getOrCreatePlayerImage(
	scene: Phaser.Scene,
	name: string,
	textureKey: string,
	state: PlayerVisualState,
): Phaser.GameObjects.Image {
	const existing = findPlayerImage(scene, name);
	if (existing) return existing;
	const created = scene.add.image(state.x, state.y, textureKey).setName(name);
	getPlayerImageCache(scene).set(name, created);
	return created;
}

function isPlayerMoving(state: PlayerVisualState): boolean {
	return Math.hypot(state.vx ?? 0, state.vy ?? 0) > RETRACT_SPEED_MIN;
}

function updateIngamePlayerRoll(
	image: Phaser.GameObjects.Image,
	state: PlayerVisualState,
	initialRotation = 0,
): void {
	const previous = rollStates.get(image);
	if (!previous) {
		image.setRotation(initialRotation);
		rollStates.set(image, { x: state.x, y: state.y });
		return;
	}

	const dx = state.x - previous.x;
	const dy = state.y - previous.y;
	const distance = Math.hypot(dx, dy);
	const teleportDistance = Math.max(
		TELEPORT_DISTANCE_MIN,
		state.r * TELEPORT_DISTANCE_RADIUS_FACTOR,
	);

	if (distance > 0 && distance < teleportDistance)
		image.rotation += distance / Math.max(1, state.r);

	rollStates.set(image, { x: state.x, y: state.y });
}

export function hideIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
): void {
	// Purge and rescan directly: hide runs in the window where scenes create
	// fallback images, so no cached miss may survive this call.
	const names = [`${name}-body`, `${name}-shell`, `${name}-fallback`, name];
	purgePlayerImageCache(scene, names);
	for (const childName of names) {
		const existing = scene.children.getByName(childName);
		if (existing instanceof Phaser.GameObjects.Image) existing.setVisible(false);
	}
}

export function destroyIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
): void {
	const names = [`${name}-body`, `${name}-shell`, `${name}-fallback`, name];
	purgePlayerImageCache(scene, names);
	for (const childName of names) {
		const existing = scene.children.getByName(childName);
		if (existing instanceof Phaser.GameObjects.Image) existing.destroy();
	}
}

function hideFallbackTexture(scene: Phaser.Scene, name: string): void {
	const existing = findPlayerImage(scene, `${name}-fallback`);
	if (existing) existing.setVisible(false);
}
