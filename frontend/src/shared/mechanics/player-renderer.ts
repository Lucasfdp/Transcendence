import Phaser from "phaser";
import { INGAME_PLAYER_ASSET } from "../assets";

interface PlayerVisualState {
	x: number;
	y: number;
	r: number;
}

interface PlayerRollState {
	x: number;
	y: number;
}

const rollStates = new WeakMap<Phaser.GameObjects.Image, PlayerRollState>();
const TELEPORT_DISTANCE_MIN = 180;
const TELEPORT_DISTANCE_RADIUS_FACTOR = 8;

export function preloadIngamePlayerTexture(scene: Phaser.Scene): void {
	if (!scene.textures.exists(INGAME_PLAYER_ASSET.key))
		scene.load.image(INGAME_PLAYER_ASSET.key, INGAME_PLAYER_ASSET.source);
}

export function drawIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
	state: PlayerVisualState,
	depth: number,
): boolean {
	if (!scene.textures.exists(INGAME_PLAYER_ASSET.key)) {
		hideIngamePlayerTexture(scene, name);
		return false;
	}

	const existing = scene.children.getByName(name);
	const image =
		existing instanceof Phaser.GameObjects.Image
			? existing
			: scene.add.image(state.x, state.y, INGAME_PLAYER_ASSET.key).setName(name);
	updateIngamePlayerRoll(image, state);

	image
		.setVisible(true)
		.setPosition(state.x, state.y)
		.setDepth(depth)
		.setDisplaySize(state.r * 2, state.r * 2);
	return true;
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
	const existing = scene.children.getByName(name);
	if (existing instanceof Phaser.GameObjects.Image) existing.setVisible(false);
}

export function destroyIngamePlayerTexture(
	scene: Phaser.Scene,
	name: string,
): void {
	const existing = scene.children.getByName(name);
	if (existing instanceof Phaser.GameObjects.Image) existing.destroy();
}
