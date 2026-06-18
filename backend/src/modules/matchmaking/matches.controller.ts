import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Match } from "./entities/match.entity";

@Controller("matches")
export class MatchesController {
	constructor(
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
	) {}

	@Get("active")
	getActive(): Promise<Match[]> {
		return this.matchRepo.find({
			where: [{ status: "pending" }, { status: "active" }],
			relations: ["players"],
			order: { createdAt: "DESC" },
			take: 50,
		});
	}

	@Get(":id")
	async getOne(@Param("id") id: string): Promise<Match> {
		const match = await this.matchRepo.findOne({
			where: { id },
			relations: ["players", "spectators"],
		});
		if (!match) throw new NotFoundException("Match not found");
		return match;
	}
}
