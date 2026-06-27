import {
	IsArray,
	IsIn,
	IsOptional,
	IsString,
	Length,
	Matches,
	ArrayMaxSize,
} from "class-validator";
import { ACHIEVEMENTS } from "../../achievements/achievements.constants";
import { TURTLE_TAG_IDS } from "../../profiles/turtle-tags.constants";

const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id);

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

	/**
	 * Single turtle personality tag chosen from the curated set.
	 * Pass null to clear.
	 */
	@IsOptional()
	@IsIn([...TURTLE_TAG_IDS, null], {
		message: `tag must be one of the valid turtle tag IDs or null`,
	})
	tag?: string | null;

	/**
	 * Up to 3 achievement IDs to showcase on the player's public profile.
	 * Each must be a valid achievement ID. Pass an empty array to clear.
	 */
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(3, { message: "showcasedAchievements may contain at most 3 entries" })
	@IsIn([...ACHIEVEMENT_IDS], {
		each: true,
		message: "each showcasedAchievements entry must be a valid achievement ID",
	})
	showcasedAchievements?: string[];
}
