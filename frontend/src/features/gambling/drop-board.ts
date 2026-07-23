/**
 * Shell Drop board rendering with a retained static layer (performance plan,
 * Phase 7). The peg lattice, gradients and all other static board geometry
 * are prerendered ONCE per (tier, canvas size, pixel ratio) into an
 * offscreen canvas; each animation frame then only blits that layer and
 * draws the two dynamic elements on top — the currently-lit bumper and the
 * falling shell. Previously every frame of the 4.2 s drop redrew every peg
 * (`~2 canvas path fills + a stroke per peg, per frame`).
 *
 * Pure-ish module: it draws on contexts it's given and creates one offscreen
 * canvas, but holds no React or per-game flow state, so a fake 2D context
 * can verify the static/dynamic split in isolation.
 */
import type { PegPosition } from "./drop-path";

/** Miniature version of the shared Temple Curling/Kame Knock bumper palette. */
export interface DropBoardPalette {
	pegEdge: string;
	pegCore: string;
}

/** Static board geometry, all in CSS pixels. */
export interface DropBoardGeometry {
	width: number;
	height: number;
	/** Horizontal margin so edge pegs aren't clipped by the board edge. */
	horizontalInsetPx: number;
	/** Vertical margin above the first peg row. */
	topInsetPx: number;
	/** Space reserved at the bottom for the bucket/multiplier row. */
	bucketRowReservedPx: number;
	/** Radius of each miniature bumper; its centre remains the peg point. */
	pegRadiusPx: number;
	/** Display size of the equipped shell artwork. */
	shellSizePx: number;
}

/** Draws one bumper. Exported for the static prerender and the lit overdraw. */
export function drawPeg(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	pegRadiusPx: number,
	palette: DropBoardPalette,
	lit: boolean,
): void {
	ctx.save();
	if (lit) {
		const glow = ctx.createRadialGradient(
			x,
			y,
			pegRadiusPx * 0.25,
			x,
			y,
			pegRadiusPx * 2.2,
		);
		glow.addColorStop(0, "rgba(255, 215, 0, 0.55)");
		glow.addColorStop(1, "transparent");
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(x, y, pegRadiusPx * 2.2, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.fillStyle = palette.pegCore;
	ctx.beginPath();
	ctx.arc(x, y, pegRadiusPx, 0, Math.PI * 2);
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = palette.pegEdge;
	ctx.globalAlpha = lit ? 1 : 0.85;
	ctx.stroke();
	ctx.fillStyle = palette.pegEdge;
	ctx.globalAlpha = lit ? 1 : 0.6;
	ctx.beginPath();
	ctx.arc(x, y, pegRadiusPx * 0.24, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** Renders board frames, reusing one prerendered static peg layer. */
export interface DropBoardRenderer {
	/**
	 * Draws one frame: the retained static layer, the bumper currently
	 * touched by the shell (if any), and the shell at its normalised
	 * position.
	 */
	drawFrame(
		ctx: CanvasRenderingContext2D,
		shellX: number,
		shellY: number,
		shellImage: CanvasImageSource | null,
	): void;
}

/**
 * Builds a renderer for one (geometry, lattice, pixel-ratio) combination.
 * Callers create a new renderer when the tier or canvas size changes and
 * reuse it for every frame in between — that reuse is the optimisation.
 */
export function createDropBoardRenderer(
	geometry: DropBoardGeometry,
	pegs: readonly PegPosition[],
	palette: DropBoardPalette,
	pixelRatio: number = globalThis.devicePixelRatio || 1,
): DropBoardRenderer {
	const usableWidth = geometry.width - geometry.horizontalInsetPx * 2;
	const usableHeight =
		geometry.height - geometry.topInsetPx - geometry.bucketRowReservedPx;
	const toPx = (nx: number, ny: number): [number, number] => [
		geometry.horizontalInsetPx + nx * usableWidth,
		geometry.topInsetPx + ny * usableHeight,
	];

	// Peg positions in CSS pixels, resolved once — the per-frame hit test and
	// the lit overdraw both reuse them instead of re-projecting every peg.
	const pegPoints = pegs.map((peg) => {
		const [x, y] = toPx(peg.x, peg.y);
		return { x, y };
	});

	// The retained static layer: every unlit peg, at the device pixel ratio,
	// drawn exactly once.
	const ratio = Math.max(1, pixelRatio);
	const staticLayer = document.createElement("canvas");
	staticLayer.width = Math.max(1, Math.round(geometry.width * ratio));
	staticLayer.height = Math.max(1, Math.round(geometry.height * ratio));
	const staticCtx = staticLayer.getContext("2d");
	if (staticCtx) {
		staticCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
		for (const point of pegPoints) {
			drawPeg(
				staticCtx,
				point.x,
				point.y,
				geometry.pegRadiusPx,
				palette,
				false,
			);
		}
	}

	return {
		drawFrame(ctx, shellX, shellY, shellImage): void {
			ctx.clearRect(0, 0, geometry.width, geometry.height);
			ctx.drawImage(
				staticLayer,
				0,
				0,
				geometry.width,
				geometry.height,
			);

			const [sx, sy] = toPx(shellX, shellY);
			let hitIndex = -1;
			let hitDistance = Number.POSITIVE_INFINITY;
			for (let index = 0; index < pegPoints.length; index += 1) {
				const point = pegPoints[index];
				const distance = Math.hypot(point.x - sx, point.y - sy);
				if (distance < hitDistance) {
					hitDistance = distance;
					hitIndex = index;
				}
			}
			if (hitIndex >= 0 && hitDistance <= geometry.shellSizePx * 0.52) {
				const point = pegPoints[hitIndex];
				drawPeg(
					ctx,
					point.x,
					point.y,
					geometry.pegRadiusPx,
					palette,
					true,
				);
			}

			if (shellImage) {
				ctx.drawImage(
					shellImage,
					sx - geometry.shellSizePx / 2,
					sy - geometry.shellSizePx / 2,
					geometry.shellSizePx,
					geometry.shellSizePx,
				);
			}
		},
	};
}
