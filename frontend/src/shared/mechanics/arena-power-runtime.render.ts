import Phaser from "phaser";

import { drawPlayerRing } from "../game-ui";
import { drawShellBallTexture } from "./ball";
import type { ArenaPowerBallEntry } from "./arena-power-runtime";
import {
	destroyIngamePlayerTexture,
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
} from "./player-renderer";

export function clearArenaPowerBallTextures(
	scene: Phaser.Scene,
	prefix: string,
	renderedCount: number,
): void {
	for (let i = 0; i < renderedCount; i++) {
		destroyIngamePlayerTexture(scene, `${prefix}-${i}`);
	}
}

export function drawArenaPowerBalls(
	scene: Phaser.Scene,
	gfx: Phaser.GameObjects.Graphics,
	entries: readonly ArenaPowerBallEntry[],
	renderedCount: number,
	options: {
		prefix: string;
		depth: number;
		playerShellSkins: readonly string[];
		colourForPlayer: (player: number) => number;
	},
): number {
	for (let i = entries.length; i < renderedCount; i++) {
		hideIngamePlayerTexture(scene, `${options.prefix}-${i}`);
	}
	for (let i = 0; i < entries.length; i++) {
		const { ball, player } = entries[i];
		if (
			!drawIngamePlayerTexture(
				scene,
				`${options.prefix}-${i}`,
				ball,
				options.depth,
				options.playerShellSkins[player],
			)
		)
			drawShellBallTexture(scene, `${options.prefix}-${i}`, ball, options.depth);
		drawPlayerRing(
			gfx,
			ball.x,
			ball.y,
			ball.r,
			options.colourForPlayer(player),
			0.8,
		);
	}
	return entries.length;
}
