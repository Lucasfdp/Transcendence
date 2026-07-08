import Phaser from "phaser";
export * from "./ball-core";
import type { BallState } from "./ball-core";
import type { RectArenaPixels } from "./rect-arena";
import { HEAVY_MASS_RATIO, PowerType } from "./power-system";

// ── Curling shell physics ────────────────────────────────────────────────────

/** Curling shell radius at source resolution. */
export const STONE_SRC_R = 28;

/**
 * Per-frame friction multiplier at 60 fps.
 * 0.990 lets a shell starting at 820 px/s travel roughly 1360 source px.
 */
export const FRICTION_ICE = 0.99;

/** Speed fraction retained on rectangular sheet wall bounce. */
export const BOUNCE_DAMP = 0.55;

/** Speed fraction retained in shell-on-shell collision. */
export const STONE_BOUNCE_DAMP = 0.92;

/** Source px/s below which the curling shell snaps to rest. */
export const MIN_SPEED_SRC = 8;

/** Default lateral curl drift. */
export const DEFAULT_CURL_BIAS = 0;

/** Radians/second per unit of curl bias. */
export const CURL_STRENGTH = 0.5;

export interface StoneState extends BallState {
	id: number;
	teamId: number;
	power: PowerType;
	stopped: boolean;
	curlBias: number;
	hasSplit?: boolean;
	splitterPending?: boolean;
	mirrorPending?: boolean;
	ghostUsed?: boolean;
	frozen?: boolean;
	frictionOverride?: number;
}

/**
 * Advance one curling shell on a rectangular sheet.
 * Kept in ball.ts so every game uses the same projectile module.
 */
export function stepStone(
	s: StoneState,
	deltaMs: number,
	a: RectArenaPixels,
): boolean {
	if (s.frozen) {
		s.stopped = true;
		s.vx = 0;
		s.vy = 0;
		return false;
	}
	if (s.stopped) return false;

	const dt = deltaMs / 1000;
	const speed = Math.hypot(s.vx, s.vy);

	if (speed > 0.001) {
		const perpX = -s.vy / speed;
		const perpY = s.vx / speed;
		s.vx += perpX * s.curlBias * CURL_STRENGTH * speed * dt;
		s.vy += perpY * s.curlBias * CURL_STRENGTH * speed * dt;
	}

	s.x += s.vx * dt;
	s.y += s.vy * dt;

	const bounceDamp = s.power === PowerType.BOUNCER ? 1.0 : BOUNCE_DAMP;
	if (a.orientation === "horizontal") {
		const topWall = a.sheetY + s.r;
		const bottomWall = a.sheetY + a.sheetH - s.r;
		const leftWall = a.sheetX + s.r;
		const rightWall = a.sheetX + a.sheetW - s.r;
		if (s.y < topWall) {
			s.y = topWall;
			s.vy = -s.vy * bounceDamp;
		} else if (s.y > bottomWall) {
			s.y = bottomWall;
			s.vy = -s.vy * bounceDamp;
		}
		if (s.x < leftWall) {
			s.x = leftWall;
			s.vx = -s.vx * bounceDamp;
		} else if (s.x > rightWall) {
			s.x = rightWall;
			s.vx = -s.vx * bounceDamp;
		}
	} else {
		const leftWall = a.sheetX + s.r;
		const rightWall = a.sheetX + a.sheetW - s.r;
		if (s.x < leftWall) {
			s.x = leftWall;
			s.vx = -s.vx * bounceDamp;
		} else if (s.x > rightWall) {
			s.x = rightWall;
			s.vx = -s.vx * bounceDamp;
		}
	}

	const friction = s.frictionOverride ?? FRICTION_ICE;
	const factor = Math.pow(friction, deltaMs / 16.67);
	s.vx *= factor;
	s.vy *= factor;

	if (Math.hypot(s.vx, s.vy) < MIN_SPEED_SRC * a.scale) {
		s.vx = 0;
		s.vy = 0;
		s.stopped = true;
		return false;
	}

	return true;
}

/** Resolve elastic collision between two curling shells. */
export function resolveStoneCollision(a: StoneState, b: StoneState): void {
	if (a.stopped && b.stopped) return;

	if (a.power === PowerType.GHOST && !a.ghostUsed) return;
	if (b.power === PowerType.GHOST && !b.ghostUsed) return;

	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.hypot(dx, dy);
	const minD = a.r + b.r;

	if (dist >= minD || dist < 0.001) return;

	const overlap = minD - dist;
	const nx = dx / dist;
	const ny = dy / dist;

	const aShare = a.frozen ? 0.0 : b.frozen ? 1.0 : 0.5;
	const bShare = b.frozen ? 0.0 : a.frozen ? 1.0 : 0.5;
	a.x -= nx * overlap * aShare;
	a.y -= ny * overlap * aShare;
	b.x += nx * overlap * bShare;
	b.y += ny * overlap * bShare;

	const dvx = b.vx - a.vx;
	const dvy = b.vy - a.vy;
	const dvDot = dvx * nx + dvy * ny;
	if (dvDot > 0) return;

	if (a.frozen || b.frozen) {
		const mover = a.frozen ? b : a;
		const dot = mover.vx * nx + mover.vy * ny;
		mover.vx = (mover.vx - 2 * dot * nx) * STONE_BOUNCE_DAMP;
		mover.vy = (mover.vy - 2 * dot * ny) * STONE_BOUNCE_DAMP;
		mover.stopped = false;
		return;
	}

	const massA = a.power === PowerType.HEAVY ? HEAVY_MASS_RATIO : 1;
	const massB = b.power === PowerType.HEAVY ? HEAVY_MASS_RATIO : 1;
	const impulse = ((2 * dvDot) / (massA + massB)) * STONE_BOUNCE_DAMP;

	a.vx += impulse * massB * nx;
	a.vy += impulse * massB * ny;
	b.vx -= impulse * massA * nx;
	b.vy -= impulse * massA * ny;

	a.stopped = false;
	b.stopped = false;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Draw the turtle-shell ball at its current position. Clears `g` first by default. */
export function drawShellBall(
	g: Phaser.GameObjects.Graphics,
	b: BallState,
	clear = true,
): void {
	const { x, y, r } = b;
	if (clear) g.clear();

	// Drop shadow
	g.fillStyle(0x000000, 0.22);
	g.fillEllipse(x + r * 0.3, y + r * 0.5, r * 2.4, r * 0.9);

	// Shell body
	g.fillStyle(0x2a7fd4, 1);
	g.fillCircle(x, y, r);

	// Dark shell-plate segments
	g.fillStyle(0x1a5fa8, 1);
	g.fillCircle(x + r * 0.25, y - r * 0.12, r * 0.38);
	g.fillCircle(x - r * 0.22, y + r * 0.28, r * 0.3);
	g.fillCircle(x + r * 0.08, y + r * 0.52, r * 0.22);

	// Specular highlight
	g.fillStyle(0xffffff, 0.55);
	g.fillCircle(x - r * 0.28, y - r * 0.3, r * 0.22);
}

/** Team colours for curling shell rendering. */
const TEAM_COLOUR = [0x2255cc, 0xcc2222, 0x22aa55, 0xbb55dd, 0xd4a843] as const;
const TEAM_DARK = [0x142e6e, 0x6e1111, 0x0e5a2c, 0x5a236b, 0x6e5414] as const;

/** Draw a curling shell at its current position. */
export function drawStone(
	g: Phaser.GameObjects.Graphics,
	s: StoneState,
	isActive: boolean,
): void {
	const { x, y, r } = s;
	g.clear();

	if (isActive) {
		g.lineStyle(3, 0xd4a843, 0.6);
		g.strokeCircle(x, y, r * 1.45);
	}

	if (s.frozen) {
		g.fillStyle(0x88ccff, 0.3);
		g.fillCircle(x, y, r * 1.15);
	}

	g.fillStyle(0x000000, 0.22);
	g.fillEllipse(x + r * 0.3, y + r * 0.4, r * 2.2, r * 0.85);

	const baseCol = TEAM_COLOUR[s.teamId % TEAM_COLOUR.length];
	g.fillStyle(baseCol, 1);
	g.fillCircle(x, y, r);

	const darkCol = TEAM_DARK[s.teamId % TEAM_DARK.length];
	g.lineStyle(Math.max(1.5, r * 0.12), darkCol, 0.75);
	const arcs = [
		{ ang0: 0.3, ang1: 1.4, rx: r * 0.55 },
		{ ang0: 1.7, ang1: 2.9, rx: r * 0.52 },
		{ ang0: 3.3, ang1: 4.5, rx: r * 0.5 },
		{ ang0: 4.8, ang1: 5.9, rx: r * 0.53 },
		{ ang0: -0.4, ang1: 0.2, rx: r * 0.45 },
	];
	for (const arc of arcs) {
		g.beginPath();
		g.arc(x, y, arc.rx, arc.ang0, arc.ang1, false);
		g.strokePath();
	}

	g.fillStyle(0xffffff, 0.5);
	g.fillCircle(x - r * 0.28, y - r * 0.28, r * 0.2);

	if (s.power !== PowerType.NONE) {
		const badgeR = Math.max(4, r * 0.22);
		g.fillStyle(0xffffff, 0.9);
		g.fillCircle(x + r * 0.62, y - r * 0.62, badgeR);
	}

	if (s.frozen) {
		g.lineStyle(1.5, 0x88ccff, 0.85);
		for (let i = 0; i < 6; i++) {
			const angle = (i / 6) * Math.PI * 2;
			g.lineBetween(
				x,
				y,
				x + Math.cos(angle) * r * 0.8,
				y + Math.sin(angle) * r * 0.8,
			);
		}
	}
}
