import type { TurnPhase, TurnState } from "./turn-manager";

export interface RoundFlowState {
	readonly playerCount: number;
	readonly currentTeam: number;
	readonly currentRound: number;
	readonly ballsLeft: number[];
	readonly score: number[];
	readonly phase: TurnPhase;
	readonly hasHammer?: boolean;
}

export function buildHudStateFromRoundFlow(
	state: RoundFlowState,
): TurnState {
	const playerCount = Math.max(1, state.playerCount, state.score.length);
	return {
		currentTeam: clamp(state.currentTeam, 0, playerCount - 1),
		currentEnd: Math.max(0, state.currentRound),
		ballsLeft: state.ballsLeft,
		score: state.score,
		phase: state.phase,
		hasHammer: state.hasHammer ?? false,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
