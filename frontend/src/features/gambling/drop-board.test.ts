/**
 * Verifies the retained-static-layer contract of the Shell Drop board
 * renderer: the peg lattice is drawn once at construction, and a frame costs
 * only a blit plus the dynamic elements (lit bumper, shell) — its canvas work
 * no longer scales with the number of pegs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDropBoardRenderer,
	type DropBoardGeometry,
} from "./drop-board";
import { pegLattice } from "./drop-path";

interface RecordingContext {
	arcCalls: number;
	drawImageCalls: number;
	clearRectCalls: number;
	gradientCalls: number;
}

function recordingContext(): CanvasRenderingContext2D & RecordingContext {
	const ctx = {
		arcCalls: 0,
		drawImageCalls: 0,
		clearRectCalls: 0,
		gradientCalls: 0,
		fillStyle: "",
		strokeStyle: "",
		globalAlpha: 1,
		lineWidth: 0,
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		setTransform: vi.fn(),
		arc(): void {
			ctx.arcCalls += 1;
		},
		drawImage(): void {
			ctx.drawImageCalls += 1;
		},
		clearRect(): void {
			ctx.clearRectCalls += 1;
		},
		createRadialGradient(): CanvasGradient {
			ctx.gradientCalls += 1;
			return { addColorStop: vi.fn() } as unknown as CanvasGradient;
		},
	};
	return ctx as unknown as CanvasRenderingContext2D & RecordingContext;
}

const GEOMETRY: DropBoardGeometry = {
	width: 400,
	height: 430,
	horizontalInsetPx: 10,
	topInsetPx: 10,
	bucketRowReservedPx: 34,
	pegRadiusPx: 6,
	shellSizePx: 52,
};

const PALETTE = { pegEdge: "#d4a843", pegCore: "#2a1a08" };

describe("createDropBoardRenderer", () => {
	let staticCtx: ReturnType<typeof recordingContext>;

	function buildRenderer(rows: number) {
		staticCtx = recordingContext();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			staticCtx,
		);
		const renderer = createDropBoardRenderer(
			GEOMETRY,
			pegLattice(rows),
			PALETTE,
			1,
		);
		vi.restoreAllMocks();
		return renderer;
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prerenders every peg into the static layer exactly once", () => {
		const rows = 8;
		const pegCount = pegLattice(rows).length;
		buildRenderer(rows);
		// Each unlit peg costs two arcs (body + centre dot) and no gradient.
		expect(staticCtx.arcCalls).toBe(pegCount * 2);
		expect(staticCtx.gradientCalls).toBe(0);
	});

	it("draws frames without re-drawing the lattice", () => {
		const renderer = buildRenderer(8);
		const staticArcsAfterBuild = staticCtx.arcCalls;
		const frameCtx = recordingContext();

		// Shell parked at the top, away from every peg: blit + shell only.
		renderer.drawFrame(frameCtx, 0.5, 0, {} as CanvasImageSource);
		expect(frameCtx.clearRectCalls).toBe(1);
		// One blit of the static layer plus the shell image.
		expect(frameCtx.drawImageCalls).toBe(2);
		expect(frameCtx.arcCalls).toBe(0);

		// The static layer was not touched again by the frame.
		expect(staticCtx.arcCalls).toBe(staticArcsAfterBuild);
	});

	it("draws only the lit bumper dynamically when the shell touches one", () => {
		const renderer = buildRenderer(8);
		const frameCtx = recordingContext();
		const pegs = pegLattice(8);

		// Position the shell exactly on the first peg.
		renderer.drawFrame(frameCtx, pegs[0].x, pegs[0].y, null);
		// A lit peg costs one glow gradient arc plus the two body arcs; the
		// remaining pegs stay in the blitted static layer.
		expect(frameCtx.arcCalls).toBe(3);
		expect(frameCtx.gradientCalls).toBe(1);
		// Static blit only — no shell image was provided.
		expect(frameCtx.drawImageCalls).toBe(1);
	});

	it("keeps the frame cost flat as the lattice grows", () => {
		// Top-left corner: far from every peg on both tiers, so neither frame
		// lights a bumper and the counts compare like for like.
		const smallRenderer = buildRenderer(8);
		const smallCtx = recordingContext();
		smallRenderer.drawFrame(smallCtx, 0, 0, null);

		const largeRenderer = buildRenderer(16);
		const largeCtx = recordingContext();
		largeRenderer.drawFrame(largeCtx, 0, 0, null);

		expect(largeCtx.arcCalls).toBe(smallCtx.arcCalls);
		expect(largeCtx.drawImageCalls).toBe(smallCtx.drawImageCalls);
	});
});
