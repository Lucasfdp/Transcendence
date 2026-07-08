/**
 * shared/mechanics/ball-powers.ts — shell power effects for ball-physics games.
 *
 * Applies a PowerType's launch-time effect to a BallState. Parallel to
 * PowerDef.onApply() (which operates on StoneState for curling).
 *
 * Usage:
 *   applyBallPower(this.activePower, this.ball, this.arena);
 *   // Must be called AFTER resetBall() so radius modifications start from base.
 *
 * Scene responsibilities after calling applyBallPower:
 *   - PHANTOM: while ball.phantomHidden, collision checks may ignore the ball
 *   - BOMB:    when ball stops, area-clear targets within BOMB_RADIUS_SRC * scale
 *   - REPEL:   when ball stops, push/clear targets within REPEL_RADIUS_SRC * scale
 *   - FREEZE:  when ball stops, pause spawn/timer mechanics for 5 000 ms
 *   - GHOST:   in collision check, if ghostUsed === false skip & set ghostUsed = true
 *
 * frictionOverride — how to apply in scene update():
 *   After stepBall(), if isBallMoving(ball) and ball.frictionOverride is set:
 *     const factor = Math.pow(ball.frictionOverride / BALL_FRICTION_BASE, delta / 16.67);
 *     ball.vx *= factor; ball.vy *= factor;
 *   This corrects for BALL_FRICTION_BASE already applied by stepBall.
 */

import type { ArenaPixels } from "../arenas/arena";
import { BALL_FRICTION_BASE, type BallState } from "./ball-core";
import {
	PowerType,
	HEAVY_SPEED_FACTOR,
	GIANT_RADIUS_FACTOR,
	TINY_RADIUS_FACTOR,
	ROCKET_SPEED_FACTOR,
	FRICTION_SLICK,
	SPINNING_CURL_BIAS,
} from "./power-system";

/** How strongly curlBias bends the ball's trajectory (radians/second per unit of bias). */
export const BALL_CURL_STRENGTH = 0.5;

// ── Extended BallState — optional properties set by applyBallPower ─────────────

/**
 * Extended BallState interface with per-shot power flags.
 * Cast `ball as BallExtState` to read/write these after calling applyBallPower.
 * Do not declare these on BallState itself (no bloat in ball.ts).
 */
export interface BallExtState extends BallState {
	/** Custom per-frame friction multiplier (replaces BALL_FRICTION_BASE in scene update). */
	frictionOverride?: number;
	/** BOMB: when ball stops, area-clear breakable targets and clear this flag. */
	bombPending?: boolean;
	/** FREEZE: when ball stops, freeze spawn/timer mechanics for 5 000 ms, then clear. */
	freezePending?: boolean;
	/**
	 * GHOST: false = not yet used (skip first collision); true = already used (normal).
	 * undefined = power is not GHOST (skip ghost logic entirely).
	 */
	ghostUsed?: boolean;
	/** PHANTOM: true while collision checks should ignore the moving ball. Clear on stop. */
	phantomHidden?: boolean;
	/** REPEL: when ball stops, push/clear targets in REPEL_RADIUS_SRC * scale, then clear. */
	repelPending?: boolean;
	/** SPINNING: continuous curl bias applied per frame — >0 curves right, <0 curves left. */
	curlBias?: number;
}

// ── Re-export for scene use ────────────────────────────────────────────────────
export { BALL_FRICTION_BASE };

// ── applyBallPower ─────────────────────────────────────────────────────────────

/**
 * Mutate `ball` at launch time to apply the selected shell power.
 * Call exactly once per shot, after resetBall() has reset ball.r and velocity.
 * Powers not in the table below are no-ops (NONE, SHIELD, VORTEX, MIRROR,
 * LIGHTNING, MAGNET, STICKY, RICOCHET, SPLITTER, BOOMERANG — these either
 * require scene-level creation logic or have no ball-physics analogue).
 */
export function applyBallPower(
	power: PowerType,
	ball: BallState,
	_arena: ArenaPixels,
): void {
	const ext = ball as BallExtState;

	// Clear any leftover flags from a previous shot (safety net — scenes should
	// already clear these in setupShot/setupBallRound/onResize).
	ext.frictionOverride = undefined;
	ext.bombPending = undefined;
	ext.freezePending = undefined;
	ext.ghostUsed = undefined;
	ext.phantomHidden = undefined;
	ext.repelPending = undefined;
	ext.curlBias = undefined;

	switch (power) {
		// ── Radius modifiers ───────────────────────────────────────────────────────
		case PowerType.HEAVY:
			ext.vx *= HEAVY_SPEED_FACTOR;
			ext.vy *= HEAVY_SPEED_FACTOR;
			break;

		case PowerType.GIANT:
			ext.r *= GIANT_RADIUS_FACTOR;
			break;

		case PowerType.TINY:
			ext.r *= TINY_RADIUS_FACTOR;
			ext.vx *= 1.35;
			ext.vy *= 1.35;
			break;

		// ── Velocity modifier ──────────────────────────────────────────────────────
		case PowerType.ROCKET:
			ext.vx *= ROCKET_SPEED_FACTOR;
			ext.vy *= ROCKET_SPEED_FACTOR;
			break;

		// ── Friction overrides (scene must apply per-frame correction after stepBall) ─
		case PowerType.SLICK:
			ext.frictionOverride = FRICTION_SLICK;
			break;

		case PowerType.BOUNCER:
			// Near-lossless wall bouncing. frictionOverride ≈ BALL_FRICTION_BASE so
			// the ball rolls about the same distance — the real effect is in the
			// BOUNCE_DAMP coefficient used by the arena wall reflections.
			ext.frictionOverride = 0.984;
			break;

		case PowerType.SPINNING:
			// Continuous curl applied per-frame in the scene update + a one-time nudge.
			ext.frictionOverride = 0.984;
			ext.curlBias = SPINNING_CURL_BIAS;
			{
				const angle = Math.atan2(ext.vy, ext.vx) + Math.PI / 18; // +10°
				const spd = Math.sqrt(ext.vx * ext.vx + ext.vy * ext.vy);
				ext.vx = Math.cos(angle) * spd;
				ext.vy = Math.sin(angle) * spd;
			}
			break;

		// ── Scene-resolved flags ───────────────────────────────────────────────────
		case PowerType.BOMB:
			ext.bombPending = true;
			break;

		case PowerType.FREEZE:
			ext.freezePending = true;
			break;

		case PowerType.GHOST:
			// false = not yet consumed; scene checks === false to detect first collision
			ext.ghostUsed = false;
			break;

		case PowerType.PHANTOM:
			ext.phantomHidden = true;
			break;

		case PowerType.REPEL:
			ext.repelPending = true;
			break;

		// ── No-op powers (scene-level or inapplicable to ball physics) ─────────────
		case PowerType.NONE:
		case PowerType.SHIELD:
		case PowerType.VORTEX:
		case PowerType.MIRROR:
		case PowerType.LIGHTNING:
		case PowerType.MAGNET:
		case PowerType.STICKY:
		case PowerType.RICOCHET:
		case PowerType.SPLITTER:
		case PowerType.BOOMERANG:
			// No ball-physics effect. Scene may implement scene-level logic separately.
			break;

		default:
			// Exhaustive check — any new PowerType added to the enum will surface here.
			break;
	}
}

/**
 * Apply a continuous curl force to a moving ball (used by SPINNING power).
 * Call once per frame after stepBall() when the ball's curlBias is set.
 */
export function applyBallCurl(ball: BallState, deltaMs: number): void {
	const ext = ball as BallExtState;
	if (ext.curlBias === undefined) return;
	const speed = Math.hypot(ball.vx, ball.vy);
	if (speed <= 0.001) return;
	const dt = deltaMs / 1000;
	const perp_x = -ball.vy / speed;
	const perp_y = ball.vx / speed;
	ball.vx += perp_x * ext.curlBias * BALL_CURL_STRENGTH * speed * dt;
	ball.vy += perp_y * ext.curlBias * BALL_CURL_STRENGTH * speed * dt;
}
