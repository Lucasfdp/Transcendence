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
	>,
): TurnState {
	const customHudState = hooks.buildHudState?.();
	if (customHudState) return customHudState;

	const score = [...hooks.getScore()];
	return buildHudStateFromRoundFlow({
		playerCount: hooks.getPlayerCount(),
		currentTeam: hooks.getCurrentPlayer(),
		currentRound: hooks.getCurrentRound(),
		stonesLeft: [...hooks.getRemainingTurns()],
		score,
		phase: hooks.getPhase(),
		hasHammer: hooks.hasHammer?.() ?? false,
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
