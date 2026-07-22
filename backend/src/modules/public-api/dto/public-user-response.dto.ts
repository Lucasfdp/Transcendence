import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PublicProfileResponseDto {
	@ApiProperty({ example: 42 })
	totalWins: number;

	@ApiProperty({ example: 12 })
	totalLosses: number;

	@ApiProperty({ example: 54 })
	gamesPlayed: number;

	@ApiProperty({ example: 3200 })
	totalCoinsEarned: number;

	@ApiPropertyOptional({ nullable: true, example: "strategist" })
	tag: string | null;

	@ApiPropertyOptional({
		type: [String],
		nullable: true,
		example: ["first-blood"],
	})
	showcasedAchievements: string[] | null;
}

export class PublicUserResponseDto {
	@ApiProperty({ example: 7 })
	id: number;

	@ApiProperty({ example: "KameMaster" })
	username: string;

	@ApiPropertyOptional({ nullable: true, example: "Kame Master" })
	turtleName: string | null;

	@ApiPropertyOptional({ nullable: true, example: "/api/uploads/avatars/7.webp" })
	avatar: string | null;

	@ApiProperty({ example: 12 })
	level: number;

	@ApiProperty({ example: 850 })
	xp: number;

	@ApiProperty({ example: 2400 })
	coins: number;

	@ApiProperty({ example: "classic" })
	shellSkin: string;

	@ApiProperty({ example: "dojo" })
	hubBackground: string;

	@ApiPropertyOptional({ nullable: true, example: null })
	hubBackgroundAlter: string | null;

	@ApiProperty({ type: String, format: "date-time" })
	createdAt: Date;

	@ApiProperty({ type: String, format: "date-time" })
	updatedAt: Date;

	@ApiProperty({ type: PublicProfileResponseDto })
	profile: PublicProfileResponseDto;
}

export class PublicMutationResponseDto {
	@ApiProperty({ example: true })
	ok: boolean;
}
