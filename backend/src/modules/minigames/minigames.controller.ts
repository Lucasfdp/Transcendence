import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

export interface MiniGameDefinition {
	id: string;
	name: string;
	status: "available" | "locked" | "coming_soon";
	description: string;
}

// The Shell Smash hub map. Each entry is a "shrine" the player can
// visit.
const MINIGAMES: MiniGameDefinition[] = [
	{
		id: "kame-knock",
		name: "Kame Knock",
		status: "available",
		description:
			"Launch your shell and clear every round.",
	},
	{
		id: "bell-clash",
		name: "Bell Clash",
		status: "available",
		description: "Ring the great temple bell.",
	},
	{
		id: "temple-curling",
		name: "Temple Curling",
		status: "available",
		description:
			"Hot-seat curling with your shell.",
	},
	{
		id: "river-rush",
		name: "River Rush",
		status: "coming_soon",
		description:
			"Race down the cherry-blossom river.",
	},
	{
		id: "bamboo-bash",
		name: "Bamboo Bash",
		status: "available",
		description: "Survive the bamboo forest.",
	},
];

@ApiTags("minigames")
@Controller("minigames")
export class MiniGamesController {
	@Get()
	findAll(): MiniGameDefinition[] {
		return MINIGAMES;
	}
}
