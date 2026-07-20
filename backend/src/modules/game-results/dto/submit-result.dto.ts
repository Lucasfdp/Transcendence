import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type GameResultOutcome = "win" | "loss" | "draw" | "completed";

export class SubmitResultDto {
	/** Identifier for the minigame, e.g. 'kame-knock'. */
	@IsString()
	gameId: string;

	/** Outcome from the local player's perspective. */
	@IsIn(["win", "loss", "draw", "completed"])
	outcome: GameResultOutcome;

	/**
	 * PERFECT rounds achieved in this match (Kame Knock: every breakable
	 * target cleared in one ball round). Participation metric like
	 * `gamesPlayed`, bounded per match; feeds achievements only.
	 */
	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(20)
	perfectRounds?: number;
}
