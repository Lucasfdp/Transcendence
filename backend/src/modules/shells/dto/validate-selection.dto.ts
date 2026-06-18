import { IsArray, IsString, ArrayMaxSize } from "class-validator";

export class ValidateSelectionDto {
	/**
	 * Array of shell type IDs the player wants to use in the upcoming game.
	 * Maximum 3 special shells (NONE is free and not counted against this limit).
	 */
	@IsArray()
	@ArrayMaxSize(3)
	@IsString({ each: true })
	shellTypes: string[];
}
