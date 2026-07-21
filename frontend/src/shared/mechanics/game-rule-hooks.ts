import { buildHudStateFromRoundFlow } from "./round-flow-hud";
import type { TurnPhase, TurnState } from "./turn-manager";

export interface GameRuleHooks<TProjectile = unknown, TObstacle = unknown> {
	readonly getPlayerCount: () => number;
	readonly getCurrentPlayer: () => number;
	readonly getCurrentRound: () => number;
	readonly getRemainingTurns: () => readonly number[];
	readonly getScore: () => readonly number[];
	readonly getPhase: () => TurnPhase;
	readonly hasHammer?: () => boolean;
	/** The player who takes the first turn this match (default 0 — see
	 *  `TurnState.firstPlayer`); only turn-based games need it. */
	readonly getFirstPlayer?: () => number;
	readonly onRelease?: (projectile: TProjectile) => void;
	readonly onProjectileSettled?: (projectile: TProjectile) => void;
	readonly onObstacleHit?: (
		obstacle: TObstacle,
		projectile: TProjectile,
	) => void;
	readonly onRoundComplete?: () => void;
	readonly computeWinner?: () => number | null;
	readonly buildHudState?: () => TurnState;
}

/**
 * The HUD's "current player" highlight for a TURN-LESS online game (every
 * seat can act whenever it wants — Bell Clash, Bamboo Bash: their engines
 * have no `currentTurn`/turn-gating at all, unlike Kame Knock or Temple
 * Curling). With no real "whose turn is it" to report, the highlight always
 * tracks the LOCAL viewer's own seat instead — never a hardcoded seat, which
 * would silently mislabel the highlight (and any per-seat status derived
 * from it, e.g. Bamboo Bash's ACTIVE/READY chips) for every viewer not
 * sitting in that exact seat, most visibly in a CPU-filled tournament match
 * where the human is rarely side 0.
 */
export function turnlessOnlineHighlight(onlineSide: number): number {
	return Math.max(0, onlineSide);
}

/**
 * Per-seat "shots remaining this round" dot count for an online arena game
 * whose engine tracks shots via a per-seat array on the wire (Bell Clash's
 * `shotCounts`). Regression: the scoreboard used to compute this from the
 * LOCAL viewer's own shot count alone and repeat that single number for
 * every seat, so every CPU's "balls left" dots on the top-bar scoreboard
 * silently mirrored the human's own remaining shots instead of each seat's
 * actual count — most visible with several CPU seats, where every one of
 * them appeared to burn shots in lockstep with the human.
 */
export function perSeatShotsRemaining(
	shotCounts: readonly number[] | undefined,
	playerCount: number,
	shotsPerRound: number,
): number[] {
	return Array.from({ length: playerCount }, (_value, player) =>
		Math.max(0, shotsPerRound - (shotCounts?.[player] ?? 0)),
	);
}

export function buildTurnStateFromGameRuleHooks(
	hooks: Pick<
		GameRuleHooks,
		| "buildHudState"
		| "getPlayerCount"
		| "getCurrentPlayer"
		| "getCurrentRound"
		| "getRemainingTurns"
		| "getScore"
		| "getPhase"
		| "hasHammer"
		| "getFirstPlayer"
	>,
): TurnState {
	const customHudState = hooks.buildHudState?.();
	if (customHudState) return customHudState;

	const score = [...hooks.getScore()];
	return buildHudStateFromRoundFlow({
		playerCount: hooks.getPlayerCount(),
		currentTeam: hooks.getCurrentPlayer(),
		currentRound: hooks.getCurrentRound(),
		ballsLeft: [...hooks.getRemainingTurns()],
		score,
		phase: hooks.getPhase(),
		hasHammer: hooks.hasHammer?.() ?? false,
		firstPlayer: hooks.getFirstPlayer?.() ?? 0,
	});
}

export function notifyGameRuleRelease<TProjectile>(
	hooks: Pick<GameRuleHooks<TProjectile>, "onRelease">,
	projectile: TProjectile,
): void {
	hooks.onRelease?.(projectile);
}

export function notifyGameRuleProjectileSettled<TProjectile>(
	hooks: Pick<GameRuleHooks<TProjectile>, "onProjectileSettled">,
	projectile: TProjectile,
): void {
	hooks.onProjectileSettled?.(projectile);
}

export function notifyGameRuleRoundComplete(
	hooks: Pick<GameRuleHooks, "onRoundComplete">,
): void {
	hooks.onRoundComplete?.();
}

export function computeGameRuleWinner(
	hooks: Pick<GameRuleHooks, "computeWinner">,
): number | null {
	return hooks.computeWinner?.() ?? null;
}
