/**
 * shared/drawBackground.ts — procedural Japanese night-sky background.
 *
 * Shared across Phaser scenes to avoid duplicating the same procedural backdrop
 * logic. Returns the array of created GameObjects so the caller can clear them
 * in a layer array on resize.
 */

import Phaser from "phaser";

const PETAL_COLOURS = [0xffb7c5, 0xff9eaf, 0xffd1dc, 0xffc0cb, 0xe8a0b4];

/**
 * Draw the full procedural background onto the scene.
 * @param scene   - The Phaser.Scene to add objects to.
 * @param depth   - Base depth for all created objects (default 0).
 * @returns An array of every created GameObject so the caller can track/clear them.
 */
export function drawBackground(
	scene: Phaser.Scene,
	depth = 0,
): Phaser.GameObjects.GameObject[] {
	const created: Phaser.GameObjects.GameObject[] = [];
	const track = (...objs: Phaser.GameObjects.GameObject[]): void => {
		created.push(...objs);
	};

	const { width, height } = scene.scale;

	// ── Sky gradient (three bands) ────────────────────────────────────────────
	const gfx = scene.add.graphics().setDepth(depth);
	track(gfx);
	gfx.fillGradientStyle(0x080620, 0x080620, 0x14083a, 0x14083a, 1);
	gfx.fillRect(0, 0, width, height * 0.55);
	gfx.fillGradientStyle(0x14083a, 0x14083a, 0x2a1050, 0x2a1050, 1);
	gfx.fillRect(0, height * 0.35, width, height * 0.3);
	gfx.fillGradientStyle(0x100c06, 0x100c06, 0x080604, 0x080604, 1);
	gfx.fillRect(0, height * 0.62, width, height * 0.38);

	// ── Stars ─────────────────────────────────────────────────────────────────
	const starCount = Math.floor((width * height) / 6000);
	for (let i = 0; i < starCount; i++) {
		const sx = Phaser.Math.Between(0, width);
		const sy = Phaser.Math.Between(0, height * 0.58);
		const sr = Phaser.Math.FloatBetween(0.4, 1.4);
		const sa = Phaser.Math.FloatBetween(0.3, 0.9);
		gfx.fillStyle(0xffffff, sa);
		gfx.fillCircle(sx, sy, sr);
	}

	// ── Moon ──────────────────────────────────────────────────────────────────
	const moonX = width * 0.74;
	const moonY = height * 0.18;
	const moonR = Math.min(width, height) * 0.075;
	gfx.fillStyle(0xfff5d6, 0.04);
	gfx.fillCircle(moonX, moonY, moonR * 2.8);
	gfx.fillStyle(0xfff5d6, 0.07);
	gfx.fillCircle(moonX, moonY, moonR * 1.9);
	gfx.fillStyle(0xfff5d6, 0.13);
	gfx.fillCircle(moonX, moonY, moonR * 1.35);
	gfx.fillStyle(0xfff5d6, 0.96);
	gfx.fillCircle(moonX, moonY, moonR);
	gfx.fillGradientStyle(
		0xfff5d6,
		0xfff5d6,
		0x14083a,
		0x14083a,
		0.04,
		0.04,
		0,
		0,
	);
	gfx.fillTriangle(
		moonX,
		moonY + moonR,
		moonX - width * 0.22,
		height * 0.75,
		moonX + width * 0.22,
		height * 0.75,
	);

	// ── Mountain silhouettes ──────────────────────────────────────────────────
	const mtGfx = scene.add.graphics().setDepth(depth);
	track(mtGfx);
	mtGfx.fillStyle(0x0e0e22, 0.38);
	mtGfx.fillTriangle(
		0,
		height * 0.72,
		width * 0.28,
		height * 0.34,
		width * 0.55,
		height * 0.72,
	);
	mtGfx.fillTriangle(
		width * 0.42,
		height * 0.72,
		width * 0.7,
		height * 0.42,
		width,
		height * 0.72,
	);
	mtGfx.fillStyle(0x12122a, 0.32);
	mtGfx.fillTriangle(
		0,
		height * 0.72,
		width * 0.18,
		height * 0.5,
		width * 0.38,
		height * 0.72,
	);
	mtGfx.fillTriangle(
		width * 0.6,
		height * 0.72,
		width * 0.82,
		height * 0.46,
		width,
		height * 0.72,
	);

	// ── Ground mist ───────────────────────────────────────────────────────────
	const mistGfx = scene.add.graphics().setDepth(depth);
	track(mistGfx);
	mistGfx.fillGradientStyle(
		0x1a0d3a,
		0x1a0d3a,
		0x1a0d3a,
		0x1a0d3a,
		0,
		0,
		0.28,
		0.28,
	);
	mistGfx.fillRect(0, height * 0.6, width, height * 0.12);

	// ── Stone path ────────────────────────────────────────────────────────────
	const pathGfx = scene.add.graphics().setDepth(depth);
	track(pathGfx);
	const pathTopW = width * 0.1;
	const pathBotW = width * 0.4;
	const pathTopY = height * 0.65;
	const cx = width / 2;
	pathGfx.fillStyle(0x2a2218, 0.88);
	pathGfx.fillPoints(
		[
			{ x: cx - pathTopW / 2, y: pathTopY },
			{ x: cx + pathTopW / 2, y: pathTopY },
			{ x: cx + pathBotW / 2, y: height },
			{ x: cx - pathBotW / 2, y: height },
		] as Phaser.Types.Math.Vector2Like[],
		true,
	);
	pathGfx.lineStyle(1, 0x0a0806, 0.45);
	for (let row = 0; row <= 7; row++) {
		const t = row / 7;
		const py = pathTopY + (height - pathTopY) * t;
		const hw = pathTopW / 2 + (pathBotW / 2 - pathTopW / 2) * t;
		pathGfx.lineBetween(cx - hw, py, cx + hw, py);
	}
	pathGfx.lineBetween(cx, pathTopY, cx, height);

	// ── Hanging lanterns ──────────────────────────────────────────────────────
	const lanternGfx = scene.add.graphics().setDepth(depth);
	track(lanternGfx);
	[0.18, 0.38, 0.62, 0.82].forEach((xFrac) => {
		const lx = width * xFrac;
		const ly = height * 0.3;
		const lw = Math.min(width, height) * 0.022;
		const lh = Math.min(width, height) * 0.04;
		lanternGfx.lineStyle(1, 0x3a2e1a, 0.7);
		lanternGfx.lineBetween(lx, 0, lx, ly - lh);
		lanternGfx.fillStyle(0x8b4513, 0.85);
		lanternGfx.fillEllipse(lx, ly, lw * 2, lh * 2);
		lanternGfx.fillStyle(0xff8c00, 0.3);
		lanternGfx.fillEllipse(lx, ly, lw * 1.4, lh * 1.4);
		lanternGfx.fillStyle(0x5a2e10, 0.9);
		lanternGfx.fillRect(lx - lw * 0.7, ly - lh - 3, lw * 1.4, 5);
		lanternGfx.fillRect(lx - lw * 0.7, ly + lh - 2, lw * 1.4, 5);
		const light = scene.add.pointlight(
			lx,
			ly + lh * 0.5,
			0xff6600,
			60,
			0.4,
			0.06,
		);
		track(light);
	});

	// ── Cherry blossom trees ──────────────────────────────────────────────────
	drawBlossomTree(
		scene,
		width * 0.06,
		height * 0.72,
		height * 0.38,
		true,
		depth,
		created,
	);
	drawBlossomTree(
		scene,
		width * 0.94,
		height * 0.72,
		height * 0.38,
		false,
		depth,
		created,
	);

	// ── Ambient floating petals ───────────────────────────────────────────────
	const petalGfx = scene.add.graphics().setDepth(depth);
	track(petalGfx);
	for (let i = 0; i < 28; i++) {
		const px = Phaser.Math.Between(0, width);
		const py = Phaser.Math.Between(height * 0.15, height * 0.85);
		const pw = Phaser.Math.Between(5, 11);
		const ph = Phaser.Math.Between(3, 7);
		petalGfx.fillStyle(
			Phaser.Math.RND.pick(PETAL_COLOURS),
			Phaser.Math.FloatBetween(0.2, 0.55),
		);
		petalGfx.fillEllipse(px, py, pw, ph);
	}

	return created;
}

function drawBlossomTree(
	scene: Phaser.Scene,
	x: number,
	baseY: number,
	height: number,
	leansRight: boolean,
	depth: number,
	out: Phaser.GameObjects.GameObject[],
): void {
	const lean = leansRight ? 1 : -1;
	const tGfx = scene.add.graphics().setDepth(depth);
	const bGfx = scene.add.graphics().setDepth(depth);
	out.push(tGfx, bGfx);

	tGfx.lineStyle(5, 0x0d0800, 0.95);
	tGfx.lineBetween(x, baseY, x + lean * 20, baseY - height * 0.45);
	tGfx.lineStyle(3.5, 0x0d0800, 0.95);
	tGfx.lineBetween(
		x + lean * 20,
		baseY - height * 0.45,
		x + lean * 35,
		baseY - height * 0.75,
	);

	const branchData = [
		{ sx: 0.4, ex: 0.7, dx: lean * 70 },
		{ sx: 0.45, ex: 0.65, dx: lean * -40 },
		{ sx: 0.65, ex: 0.88, dx: lean * 55 },
		{ sx: 0.7, ex: 0.85, dx: lean * -30 },
		{ sx: 0.8, ex: 1.0, dx: lean * 40 },
	];
	branchData.forEach(({ sx, ex, dx }) => {
		const startX = x + lean * Phaser.Math.Linear(0, 40, sx);
		const startY = baseY - height * sx;
		const endX = startX + dx;
		const endY = baseY - height * ex;
		tGfx.lineStyle(2, 0x0d0800, 0.85);
		tGfx.lineBetween(startX, startY, endX, endY);
		const clusterCount = Phaser.Math.Between(3, 7);
		for (let i = 0; i < clusterCount; i++) {
			bGfx.fillStyle(
				Phaser.Math.RND.pick(PETAL_COLOURS),
				Phaser.Math.FloatBetween(0.55, 0.85),
			);
			bGfx.fillCircle(
				endX + Phaser.Math.Between(-18, 18),
				endY + Phaser.Math.Between(-10, 10),
				Phaser.Math.Between(4, 9),
			);
		}
	});
}
