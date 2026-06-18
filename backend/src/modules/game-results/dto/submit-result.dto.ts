import { IsIn, IsString } from "class-validator";

export class SubmitResultDto {
	/** Identifier for the minigame, e.g. 'kame-knock'. */
	@IsString()
	gameId: string;

	/** Outcome from the local player's perspective. */
	@IsIn(["win", "loss"])
	outcome: "win" | "loss";
}
