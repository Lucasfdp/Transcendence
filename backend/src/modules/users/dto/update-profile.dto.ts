import { IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";

export class UpdateProfileDto {
	/**
	 * Display name of the player's turtle.
	 * Allowed characters: letters, digits, underscore, hyphen, space.
	 */
	@IsOptional()
	@IsString()
	@Length(2, 32)
	@Matches(/^[a-zA-Z0-9_\- ]+$/, {
		message:
			"turtleName may only contain letters, digits, underscores, hyphens, and spaces",
	})
	turtleName?: string;

	/** Short player bio stored on the linked Profile record. */
	@IsOptional()
	@IsString()
	@MaxLength(200)
	bio?: string;
}
