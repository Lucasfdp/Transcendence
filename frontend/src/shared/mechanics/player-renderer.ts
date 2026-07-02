import Phaser from "phaser";
import { INGAME_PLAYER_ASSET, SHELL_SKIN_ASSETS, resolveShellSkinAsset } from "../assets";

interface PlayerVisualState {
	x: number;
	y: number;
	r: number;
	vx?: number;
	vy?: number;
}

interface PlayerRollState {
	x: number;
	y: number;
}

const rollStates = new WeakMap<Phaser.GameObjects.Image, PlayerRollState>();
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
	if (shell.texture.key !== shellAsset.key) shell.setTexture(shellAsset.key);
	updateIngamePlayerRoll(shell, state);

	const isRetracted = isPlayerMoving(state);
	body
		.setVisible(!isRetracted)
		.setPosition(state.x, state.y)
		.setDepth(depth)
		.setRotation(0)
		.setDisplaySize(state.r * 2, state.r * 2);

	shell
		.setVisible(true)
		.setPosition(state.x, state.y)
		.setDepth(depth + 0.01)
		.setRotation(isRetracted ? shell.rotation : 0)
		.setDisplaySize(state.r * 2, state.r * 2);
	return true;
}

function getOrCreatePlayerImage(
	scene: Phaser.Scene,
	name: string,
	textureKey: string,
	state: PlayerVisualState,
): Phaser.GameObjects.Image {
	const existing = scene.children.getByName(name);
	return existing instanceof Phaser.GameObjects.Image
		? existing
		: scene.add.image(state.x, state.y, textureKey).setName(name);
}

function isPlayerMoving(state: PlayerVisualState): boolean {
	return Math.hypot(state.vx ?? 0, state.vy ?? 0) > RETRACT_SPEED_MIN;
}

function updateIngamePlayerRoll(
	image: Phaser.GameObjects.Image,
	state: PlayerVisualState,
): void {
	const previous = rollStates.get(image);
	if (!previous) {
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
	for (const childName of [`${name}-body`, `${name}-shell`, name]) {
		const existing = scene.children.getByName(childName);
		if (existing instanceof Phaser.GameObjects.Image) existing.setVisible(false);
	}
}

export function destroyIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
): void {
	for (const childName of [`${name}-body`, `${name}-shell`, name]) {
		const existing = scene.children.getByName(childName);
		if (existing instanceof Phaser.GameObjects.Image) existing.destroy();
	}
}
