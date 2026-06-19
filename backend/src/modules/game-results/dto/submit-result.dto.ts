import { IsIn, IsString } from "class-validator";

export type GameResultOutcome = "win" | "loss" | "draw" | "completed";

export class SubmitResultDto {
	/** Identifier for the minigame, e.g. 'kame-knock'. */
	@IsString()
	gameId: string;

	/** Outcome from the local player's perspective. */
	@IsIn(["win", "loss", "draw", "completed"])
	outcome: GameResultOutcome;
}
