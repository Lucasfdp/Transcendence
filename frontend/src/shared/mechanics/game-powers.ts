/**
 * shared/mechanics/game-powers.ts
 *
 * Defines the active shell powers shown to players.
 * Pending powers stay implemented in power-system.ts but are not exposed here.
 *
 * NONE is always implicitly available and must NOT appear in this list.
 */

import type Phaser from "phaser";
import { PowerType } from "./power-system";

export type GameId =
	| "temple-curling"
	| "bamboo-bash"
	| "bell-clash"
	| "kame-knock";

/** Active special shell powers (excludes NONE, which is always implicit). */
export const ALL_SPECIAL_POWERS: PowerType[] = [
	PowerType.HEAVY,
	PowerType.SPLITTER,
	PowerType.SPINNING,
	PowerType.ROCKET,
	PowerType.GIANT,
	PowerType.TINY,
	PowerType.MIRROR,
	PowerType.PHANTOM,
];

/**
 * Every game exposes the active power roster.
 * Kept as a Record<GameId, ...> so existing call-sites (scene fallback pools,
 * type-checks) continue to compile without changes.
 */
export const GAME_POWERS: Record<GameId, PowerType[]> = {
	"temple-curling": ALL_SPECIAL_POWERS,
	"bamboo-bash": ALL_SPECIAL_POWERS,
	"bell-clash": ALL_SPECIAL_POWERS,
	"kame-knock": ALL_SPECIAL_POWERS,
};

export const POWER_UP_ASSETS: Record<PowerType, string | null> = {
	[PowerType.NONE]: null,
	[PowerType.HEAVY]: "/assets/power-ups/heavyPower.png",
	[PowerType.BOMB]: null,
	[PowerType.SPLITTER]: "/assets/power-ups/splitterPower.png",
	[PowerType.GHOST]: null,
	[PowerType.MAGNET]: null,
	[PowerType.SPINNING]: "/assets/power-ups/spinningPower.png",
	[PowerType.BOUNCER]: null,
	[PowerType.SHIELD]: null,
	[PowerType.FREEZE]: null,
	[PowerType.SLICK]: null,
	[PowerType.ROCKET]: "/assets/power-ups/rocketPower.png",
	[PowerType.GIANT]: "/assets/power-ups/giantPower.png",
	[PowerType.TINY]: "/assets/power-ups/tinyPower.png",
	[PowerType.BOOMERANG]: null,
	[PowerType.REPEL]: null,
	[PowerType.STICKY]: null,
	[PowerType.LIGHTNING]: null,
	[PowerType.VORTEX]: null,
	[PowerType.MIRROR]: "/assets/power-ups/mirrorPower.png",
	[PowerType.RICOCHET]: null,
	[PowerType.PHANTOM]: "/assets/power-ups/phantomPower.png",
};

export const POWER_UP_TEXTURES: Record<PowerType, string | null> = {
	[PowerType.NONE]: null,
	[PowerType.HEAVY]: "power-up-heavy",
	[PowerType.BOMB]: null,
	[PowerType.SPLITTER]: "power-up-splitter",
	[PowerType.GHOST]: null,
	[PowerType.MAGNET]: null,
	[PowerType.SPINNING]: "power-up-spinning",
	[PowerType.BOUNCER]: null,
	[PowerType.SHIELD]: null,
	[PowerType.FREEZE]: null,
	[PowerType.SLICK]: null,
	[PowerType.ROCKET]: "power-up-rocket",
	[PowerType.GIANT]: "power-up-giant",
	[PowerType.TINY]: "power-up-tiny",
	[PowerType.BOOMERANG]: null,
	[PowerType.REPEL]: null,
	[PowerType.STICKY]: null,
	[PowerType.LIGHTNING]: null,
	[PowerType.VORTEX]: null,
	[PowerType.MIRROR]: "power-up-mirror",
	[PowerType.RICOCHET]: null,
	[PowerType.PHANTOM]: "power-up-phantom",
};

export function preloadPowerUpAssets(scene: Phaser.Scene): void {
	for (const type of ALL_SPECIAL_POWERS) {
		const texture = POWER_UP_TEXTURES[type];
		const asset = POWER_UP_ASSETS[type];
		if (texture && asset && !scene.textures.exists(texture))
			scene.load.image(texture, asset);
	}
}
