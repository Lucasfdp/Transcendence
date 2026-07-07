import Phaser from "phaser";
import type { TurnPhase, TurnState } from "./turn-manager";

export interface RoundFlowState {
	readonly playerCount: number;
	readonly currentTeam: number;
	readonly currentRound: number;
	readonly stonesLeft: number[];
	readonly score: number[];
	readonly phase: TurnPhase;
}

export function buildHudStateFromRoundFlow(
	state: RoundFlowState,
): TurnState {
	const playerCount = Math.max(1, state.playerCount, state.score.length);
	return {
		currentTeam: Phaser.Math.Clamp(state.currentTeam, 0, playerCount - 1),
		currentEnd: Math.max(0, state.currentRound),
		stonesLeft: state.stonesLeft,
		score: state.score,
		phase: state.phase,
		hasHammer: false,
	};
}
