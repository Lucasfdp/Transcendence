/**
 * game/mechanics/power-system.ts — power-up definitions for Shell Smash minigames.
 *
 * Games import PowerType, PowerDef, PowerRegistry, and ALL_POWERS.
 * Each game opts into only the powers it wants to offer via PowerRegistry.
 * This file has zero imports from any specific minigame directory.
 */

import type { CurlingBallState } from "./ball";
import type { RectArenaPixels } from "./rect-arena";

// ── Power enum ────────────────────────────────────────────────────────────────

export enum PowerType {
	NONE = "none",
	HEAVY = "heavy",
	BOMB = "bomb",
	SPLITTER = "splitter",
	GHOST = "ghost",
	MAGNET = "magnet",
	SPINNING = "spinning",
	BOUNCER = "bouncer",
	SHIELD = "shield",
	FREEZE = "freeze",
	SLICK = "slick",
	// ── New power types ──────────────────────────────────────────────────────────
	ROCKET = "rocket", // 2× launch speed, zero curl
	GIANT = "giant", // 2× radius, slower delivery
	TINY = "tiny", // 0.5× radius, faster, harder to hit
	BOOMERANG = "boomerang", // curves back towards delivery point after 60% travel
	REPEL = "repel", // pushes all balls away on stop (inverse MAGNET)
	STICKY = "sticky", // fuses with first ball it contacts; they coast together
	LIGHTNING = "lightning", // on stop: teleports the nearest enemy ball off-sheet
	VORTEX = "vortex", // spirals inward when near the house centre
	MIRROR = "mirror", // spawns a mirror-image ball on the opposite curl path
	RICOCHET = "ricochet", // passes through first ball, hits second at full speed
	PHANTOM = "phantom", // ignored by collision checks while moving
}

// ── Power definition interface ────────────────────────────────────────────────

export interface PowerDef {
	readonly type: PowerType;
	readonly label: string;
	readonly accentColour: number;
	readonly description: string;
	/** Mutate ball properties immediately on launch. */
	onApply(ball: CurlingBallState, arena: RectArenaPixels): void;
	/** Called every frame while ball is moving (optional). */
	onUpdate?(ball: CurlingBallState, deltaMs: number, arena: RectArenaPixels): void;
	/** Called on ball-ball collision (optional). */
	onCollide?(
		ball: CurlingBallState,
		other: CurlingBallState,
		arena: RectArenaPixels,
	): void;
	/** Called when the ball comes to rest (optional). */
	onStop?(
		ball: CurlingBallState,
		arena: RectArenaPixels,
		allBalls: CurlingBallState[],
	): void;
}

// ── Physics constants used by powers ──────────────────────────────────────────

/** Near-frictionless multiplier for SLICK (per-frame at 60 fps). */
export const FRICTION_SLICK = 0.994;
/** HEAVY launch speed multiplier. */
export const HEAVY_SPEED_FACTOR = 0.75;
/** Mass ratio applied to collision impulse for HEAVY balls. */
export const HEAVY_MASS_RATIO = 2.5;
/** SPINNING curl bias (4× default CURL_BIAS — dramatic arc across the sheet). */
export const SPINNING_CURL_BIAS = 4.0;
/** Explosion push radius in source px — scale by arena.scale at runtime. */
export const BOMB_RADIUS_SRC = 160;
/** Radial velocity impulse from BOMB in source px/s. */
export const BOMB_IMPULSE_SRC = 380;
/** Range within which MAGNET attracts in source px. */
export const MAGNET_RANGE_SRC = 220;
/** Attraction velocity for MAGNET in source px/s. */
export const MAGNET_PULL_SRC = 55;
/** SPLITTER child ball radius factor. */
export const SPLITTER_RADIUS = 0.75;
/** Spread angle (radians) for SPLITTER child balls. */
export const SPLITTER_SPREAD = Math.PI / 12; // 15°
/** ROCKET launch speed multiplier. */
export const ROCKET_SPEED_FACTOR = 2.0;
/** GIANT ball radius multiplier (slower, hits hard). */
export const GIANT_RADIUS_FACTOR = 2.0;
/** TINY ball radius multiplier (fast, precise). */
export const TINY_RADIUS_FACTOR = 0.5;
/** REPEL push radius in source px (same blast area as BOMB). */
export const REPEL_RADIUS_SRC = 200;
/** REPEL push velocity in source px/s. */
export const REPEL_IMPULSE_SRC = 300;
/** Travel fraction at which BOOMERANG reversal begins (0–1). */
export const BOOMERANG_FLIP_FRAC = 0.6;
/** VORTEX spiral pull strength in source px/s when near house centre. */
export const VORTEX_PULL_SRC = 40;
/** Distance from house centre (src px) at which VORTEX activates. */
export const VORTEX_RANGE_SRC = 180;

// ── Power implementations ─────────────────────────────────────────────────────

const NONE_DEF: PowerDef = {
	type: PowerType.NONE,
	label: "No Power",
	accentColour: 0x888888,
	description: "Standard shell — no special ability.",
	onApply() {
		/* nothing */
	},
};

const HEAVY_DEF: PowerDef = {
	type: PowerType.HEAVY,
	label: "Heavy Shell",
	accentColour: 0x886633,
	description: "Slower and heavier, harder to deflect. Slower curl.",
	onApply(ball) {
		ball.vx *= HEAVY_SPEED_FACTOR;
		ball.vy *= HEAVY_SPEED_FACTOR;
		ball.curlBias *= 0.4; // harder to drift
	},
};

const BOMB_DEF: PowerDef = {
	type: PowerType.BOMB,
	label: "Bomb Shell",
	accentColour: 0xff6600,
	description: "Explodes on rest — pushes all nearby shells outward.",
	onApply() {
		/* nothing at launch */
	},
	onStop(ball, arena, allBalls) {
		const blastR = BOMB_RADIUS_SRC * arena.scale;
		const impulse = BOMB_IMPULSE_SRC * arena.scale;
		for (const other of allBalls) {
			if (other.id === ball.id) continue;
			const dx = other.x - ball.x;
			const dy = other.y - ball.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < blastR && dist > 0.001) {
				const nx = dx / dist;
				const ny = dy / dist;
				const falloff = 1 - dist / blastR;
				other.vx += nx * impulse * falloff;
				other.vy += ny * impulse * falloff;
				other.stopped = false;
			}
		}
		// TODO(#audio): scene.sound.play('bomb-explode')
	},
};

const SPLITTER_DEF: PowerDef = {
	type: PowerType.SPLITTER,
	label: "Splitter",
	accentColour: 0xffee00,
	description: "Splits into 3 smaller shells when picked up.",
	onApply(ball) {
		(ball as SplittableBall).splitterPending = true;
	},
	// Actual split logic is handled in ShellCurlScene which can create new balls.
	// The flag is read by the scene; see ball.splitterPending.
};

const GHOST_DEF: PowerDef = {
	type: PowerType.GHOST,
	label: "Ghost Shell",
	accentColour: 0xaaddff,
	description: "Passes through the first shell it hits.",
	onApply() {
		/* nothing at launch */
	},
	onCollide(ball) {
		if (!(ball as GhostBall).ghostUsed) {
			(ball as GhostBall).ghostUsed = true;
			// TODO(#ghost-visual): brief translucent overlay on pass-through
		}
	},
};

const MAGNET_DEF: PowerDef = {
	type: PowerType.MAGNET,
	label: "Magnet Shell",
	accentColour: 0xff44cc,
	description: "Pulls nearby shells towards it when it stops.",
	onApply() {
		/* nothing at launch */
	},
	onStop(ball, arena, allBalls) {
		const range = MAGNET_RANGE_SRC * arena.scale;
		const pull = MAGNET_PULL_SRC * arena.scale;
		for (const other of allBalls) {
			if (other.id === ball.id || other.stopped) continue;
			const dx = ball.x - other.x;
			const dy = ball.y - other.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < range && dist > 0.001) {
				const nx = dx / dist;
				const ny = dy / dist;
				other.vx += nx * pull;
				other.vy += ny * pull;
				other.stopped = false;
			}
		}
		// TODO(#magnet-visual): dotted line overlay for 1.5 s
	},
};

const SPINNING_DEF: PowerDef = {
	type: PowerType.SPINNING,
	label: "Spinning Shell",
	accentColour: 0x44ffcc,
	description: "Extreme curl — arcs dramatically across the sheet.",
	onApply(ball) {
		ball.curlBias = SPINNING_CURL_BIAS;
		// Higher friction compensates for the longer spiral path — stops in ~2 s.
		(ball as SlickBall).frictionOverride = 0.984;
		// TODO(#spinning-trail): add particle emitter (ice-blue spiral)
	},
};

const BOUNCER_DEF: PowerDef = {
	type: PowerType.BOUNCER,
	label: "Bouncer Shell",
	accentColour: 0xff8800,
	description: "Bounces off side-walls without losing speed.",
	// No bounce damping means friction is the sole brake — use higher friction
	// so the ball doesn't bounce forever.
	onApply(ball) {
		(ball as SlickBall).frictionOverride = 0.984;
	},
};

const SHIELD_DEF: PowerDef = {
	type: PowerType.SHIELD,
	label: "Shield Shell",
	accentColour: 0x44cc44,
	description:
		"Lands normally. If it stops inside the house it becomes very hard to knock out.",
	onApply() {
		/* nothing at launch */
	},
	onStop(ball, arena) {
		// Only activate the shield if the ball actually landed inside the house.
		const dx = ball.x - arena.houseFarCX;
		const dy = ball.y - arena.houseFarCY;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist <= arena.houseRadii[0]) {
			// Make it behave like a very heavy ball so collisions barely move it.
			ball.power = PowerType.HEAVY;
		}
	},
};

const FREEZE_DEF: PowerDef = {
	type: PowerType.FREEZE,
	label: "Freeze Shell",
	accentColour: 0x88ccff,
	description:
		"Freezes the first enemy shell it touches for the rest of the end.",
	onApply() {
		/* nothing at launch */
	},
	onCollide(_ball, other) {
		other.vx = 0;
		other.vy = 0;
		other.stopped = true;
		(other as FrozenBall).frozen = true;
	},
};

const SLICK_DEF: PowerDef = {
	type: PowerType.SLICK,
	label: "Slick Shell",
	accentColour: 0xccffee,
	description: "Near-zero friction — travels much farther than normal.",
	onApply(ball) {
		(ball as SlickBall).frictionOverride = FRICTION_SLICK;
	},
};

// ── New power implementations ─────────────────────────────────────────────────

/** Internal flag on a ball that PHANTOM collision checks should ignore. */
interface PhantomBall {
	phantomHidden: boolean;
}
/** Internal flag on a ball that has completed a BOOMERANG reversal. */
interface BoomerangBall {
	boomerangFlipped: boolean;
	launchVx: number;
	launchVy: number;
	distTravelled: number;
	totalDist: number;
}
/** Internal flag used by STICKY fuse logic. */
interface StickyBall {
	stickyFused: boolean;
	stickyPartnerId?: number;
}
/** Internal flag marking a RICOCHET ball that has already passed through one ball. */
interface RicochetBall {
	ricochetUsed: boolean;
}

const ROCKET_DEF: PowerDef = {
	type: PowerType.ROCKET,
	label: "Rocket Shell",
	accentColour: 0xff2222,
	description:
		"Launches at 2× speed with zero curl — straight line, maximum impact.",
	onApply(ball) {
		ball.vx *= ROCKET_SPEED_FACTOR;
		ball.vy *= ROCKET_SPEED_FACTOR;
		ball.curlBias = 0;
	},
};

const GIANT_DEF: PowerDef = {
	type: PowerType.GIANT,
	label: "Giant Shell",
	accentColour: 0xaa44ff,
	description: "Double the radius. Slow but nearly impossible to avoid.",
	onApply(ball) {
		ball.r *= GIANT_RADIUS_FACTOR;
		ball.curlBias *= 0.3;
		(ball as SlickBall).frictionOverride = 0.982; // slower stop
	},
};

const TINY_DEF: PowerDef = {
	type: PowerType.TINY,
	label: "Tiny Shell",
	accentColour: 0x44ffaa,
	description: "Half the size, faster and harder to knock away once placed.",
	onApply(ball) {
		ball.r *= TINY_RADIUS_FACTOR;
		ball.vx *= 1.35;
		ball.vy *= 1.35;
		ball.curlBias *= 0.6;
	},
};

const BOOMERANG_DEF: PowerDef = {
	type: PowerType.BOOMERANG,
	label: "Boomerang Shell",
	accentColour: 0xffcc44,
	description:
		"Travels forward, then curves back towards the delivery point.",
	onApply(ball) {
		const s = ball as unknown as BoomerangBall;
		s.boomerangFlipped = false;
		s.launchVx = ball.vx;
		s.launchVy = ball.vy;
		s.distTravelled = 0;
		s.totalDist =
			Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) * 2.0;
	},
	onUpdate(ball, deltaMs) {
		const s = ball as unknown as BoomerangBall;
		if (s.boomerangFlipped) return;
		const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
		s.distTravelled += spd * (deltaMs / 1000);
		if (
			s.totalDist > 0 &&
			s.distTravelled / s.totalDist >= BOOMERANG_FLIP_FRAC
		) {
			s.boomerangFlipped = true;
			// Reverse the velocity direction so the ball curves back
			ball.vx = -Math.abs(s.launchVx) * 0.55 * (ball.vx < 0 ? -1 : 1);
			ball.vy = -Math.abs(s.launchVy) * 0.55;
		}
	},
};

const REPEL_DEF: PowerDef = {
	type: PowerType.REPEL,
	label: "Repel Shell",
	accentColour: 0xff44aa,
	description:
		"Pushes all shells away when it stops — the inverse of MAGNET.",
	onApply() {
		/* nothing at launch */
	},
	onStop(ball, arena, allBalls) {
		const blastR = REPEL_RADIUS_SRC * arena.scale;
		const impulse = REPEL_IMPULSE_SRC * arena.scale;
		for (const other of allBalls) {
			if (other.id === ball.id) continue;
			const dx = other.x - ball.x;
			const dy = other.y - ball.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < blastR && dist > 0.001) {
				const nx = dx / dist;
				const ny = dy / dist;
				const falloff = 1 - dist / blastR;
				other.vx += nx * impulse * falloff;
				other.vy += ny * impulse * falloff;
				other.stopped = false;
			}
		}
	},
};

const STICKY_DEF: PowerDef = {
	type: PowerType.STICKY,
	label: "Sticky Shell",
	accentColour: 0x996633,
	description:
		"Fuses with the first shell it touches — they glide together and stop as a pair.",
	onApply(ball) {
		(ball as unknown as StickyBall).stickyFused = false;
	},
	onCollide(ball, other) {
		const s = ball as unknown as StickyBall;
		if (s.stickyFused) return;
		s.stickyFused = true;
		s.stickyPartnerId = other.id;
		// Average the velocities so they coast as one mass
		const avgVx = (ball.vx + other.vx) * 0.5;
		const avgVy = (ball.vy + other.vy) * 0.5;
		ball.vx = avgVx;
		ball.vy = avgVy;
		other.vx = avgVx;
		other.vy = avgVy;
		other.stopped = false;
	},
};

const LIGHTNING_DEF: PowerDef = {
	type: PowerType.LIGHTNING,
	label: "Lightning Shell",
	accentColour: 0xeeff00,
	description:
		"On stop, the nearest enemy shell is instantly struck off the sheet.",
	onApply() {
		/* nothing at launch */
	},
	onStop(ball, arena, allBalls) {
		// The scene is responsible for determining ownership;
		// we eject the nearest OTHER ball by placing it outside the sheet bounds.
		let nearest: CurlingBallState | null = null;
		let nearDist = Infinity;
		for (const other of allBalls) {
			if (other.id === ball.id) continue;
			const dx = other.x - ball.x;
			const dy = other.y - ball.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < nearDist) {
				nearDist = dist;
				nearest = other;
			}
		}
		if (nearest) {
			// Move the ball well outside the right edge of the sheet
			nearest.x = arena.sheetX + arena.sheetW + nearest.r * 4;
			nearest.stopped = true;
			nearest.vx = 0;
			nearest.vy = 0;
			// TODO(#lightning-visual): flash effect and strike line animation
		}
	},
};

const VORTEX_DEF: PowerDef = {
	type: PowerType.VORTEX,
	label: "Vortex Shell",
	accentColour: 0x2244ff,
	description:
		"Spirals inward as it approaches the house centre — unpredictable path.",
	onApply() {
		/* nothing at launch */
	},
	onUpdate(ball, _deltaMs, arena) {
		if (ball.stopped) return;
		const dx = arena.houseFarCX - ball.x;
		const dy = arena.houseFarCY - ball.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < VORTEX_RANGE_SRC * arena.scale && dist > 0.001) {
			const pull = VORTEX_PULL_SRC * arena.scale;
			ball.vx += (dx / dist) * pull * 0.016; // ~per-frame at 60fps
			ball.vy += (dy / dist) * pull * 0.016;
		}
	},
};

const MIRROR_DEF: PowerDef = {
	type: PowerType.MIRROR,
	label: "Mirror",
	accentColour: 0x88ff88,
	description:
		"Creates a mirror copy on the opposite path. Scene must handle the mirror flag.",
	onApply(ball) {
		// The scene reads `mirrorPending` and creates the mirror ball.
		(ball as unknown as { mirrorPending: boolean }).mirrorPending = true;
	},
};

const RICOCHET_DEF: PowerDef = {
	type: PowerType.RICOCHET,
	label: "Ricochet Shell",
	accentColour: 0xff8844,
	description:
		"Passes straight through the first shell it hits, then impacts the second at full speed.",
	onApply(ball) {
		(ball as unknown as RicochetBall).ricochetUsed = false;
	},
	onCollide(ball, _other) {
		const s = ball as unknown as RicochetBall;
		if (!s.ricochetUsed) {
			s.ricochetUsed = true;
			// Signal the scene's collision resolver to skip impulse exchange this once.
			// Flagged by setting the power temporarily to GHOST semantics.
			(ball as unknown as GhostBall).ghostUsed = false; // reset ghost flag if any
		}
	},
};

const PHANTOM_DEF: PowerDef = {
	type: PowerType.PHANTOM,
	label: "Phantom Shell",
	accentColour: 0xdddddd,
	description:
		"Invisible only to collisions while moving; visuals stay readable.",
	onApply(ball) {
		(ball as unknown as PhantomBall).phantomHidden = true;
	},
	onStop(ball) {
		(ball as unknown as PhantomBall).phantomHidden = false;
	},
};

// ── GameEffectHook — for non-physics games ────────────────────────────────────

/**
 * Defines the effect of a shell power in games that don't use the curling
 * physics engine (BambooBash, BellClash, KameKnock). Each game defines its own
 * GAME_EFFECTS map with stub or real implementations per PowerType.
 *
 * @template TState The game-specific state object (scoring context, shot state, etc.)
 */
export interface GameEffectHook<TState> {
	/**
	 * Called once when the player activates this shell for the current round/shot.
	 * Mutate `state` in place to apply the effect.
	 */
	onActivate(state: TState): void;
}

// ── Registry ──────────────────────────────────────────────────────────────────

/** Map of all built-in power definitions. */
export const ALL_POWERS: Record<PowerType, PowerDef> = {
	[PowerType.NONE]: NONE_DEF,
	[PowerType.HEAVY]: HEAVY_DEF,
	[PowerType.BOMB]: BOMB_DEF,
	[PowerType.SPLITTER]: SPLITTER_DEF,
	[PowerType.GHOST]: GHOST_DEF,
	[PowerType.MAGNET]: MAGNET_DEF,
	[PowerType.SPINNING]: SPINNING_DEF,
	[PowerType.BOUNCER]: BOUNCER_DEF,
	[PowerType.SHIELD]: SHIELD_DEF,
	[PowerType.FREEZE]: FREEZE_DEF,
	[PowerType.SLICK]: SLICK_DEF,
	[PowerType.ROCKET]: ROCKET_DEF,
	[PowerType.GIANT]: GIANT_DEF,
	[PowerType.TINY]: TINY_DEF,
	[PowerType.BOOMERANG]: BOOMERANG_DEF,
	[PowerType.REPEL]: REPEL_DEF,
	[PowerType.STICKY]: STICKY_DEF,
	[PowerType.LIGHTNING]: LIGHTNING_DEF,
	[PowerType.VORTEX]: VORTEX_DEF,
	[PowerType.MIRROR]: MIRROR_DEF,
	[PowerType.RICOCHET]: RICOCHET_DEF,
	[PowerType.PHANTOM]: PHANTOM_DEF,
};

/**
 * Games instantiate their own registry and register only the powers they want
 * to expose to players. Other games can reuse the same power definitions.
 */
export class PowerRegistry {
	private readonly defs = new Map<PowerType, PowerDef>();

	register(def: PowerDef): this {
		this.defs.set(def.type, def);
		return this;
	}

	get(type: PowerType): PowerDef {
		const def = this.defs.get(type) ?? ALL_POWERS[PowerType.NONE];
		return def;
	}

	available(): PowerDef[] {
		return [...this.defs.values()];
	}
}

// ── Extended ball interfaces (flags added by powers) ─────────────────────────
// These are structural extensions to CurlingBallState used internally by power logic.

interface SplittableBall {
	hasSplit: boolean;
	splitterPending: boolean;
}

interface GhostBall {
	ghostUsed: boolean;
}

interface FrozenBall {
	frozen: boolean;
}

interface SlickBall {
	frictionOverride: number;
}

// ── New power ball interfaces (used internally by power implementations above) ─

export interface BoomerangCurlingBallState {
	boomerangFlipped: boolean;
	launchVx: number;
	launchVy: number;
	distTravelled: number;
	totalDist: number;
}

export interface StickyCurlingBallState {
	stickyFused: boolean;
	stickyPartnerId?: number;
}

export interface RicochetCurlingBallState {
	ricochetUsed: boolean;
}

export interface PhantomCurlingBallState {
	phantomHidden: boolean;
}

export interface MirrorCurlingBallState {
	mirrorPending: boolean;
}
