import {
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Match } from "./entities/match.entity";
import { ReplayImportDto } from "./dto/replay-import.dto";
import {
	ReplayDetailView,
	ReplayService,
	ReplaySummaryView,
} from "./replay.service";

@UseGuards(JwtAuthGuard)
@Controller("matches")
export class MatchesController {
	constructor(
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
		private readonly replayService: ReplayService,
	) {}

	@Get("replays/me")
	getMyReplays(
		@Request() req: { user: { id: number } },
	): Promise<ReplaySummaryView[]> {
		return this.replayService.listForUser(req.user.id);
	}

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

	@Get(":id/replay")
	getReplay(
		@Param("id") id: string,
		@Request() req: { user: { id: number } },
	): Promise<ReplayDetailView> {
		return this.replayService.getForUser(id, req.user.id);
	}

	@Post("replays/import")
	importReplay(
		@Body() body: ReplayImportDto,
		@Request() req: { user: { id: number } },
	): Promise<ReplaySummaryView> {
		return this.replayService.importSingleplayerReplayForUser(req.user, body);
	}

	@Post(":id/replay/save")
	saveReplay(
		@Param("id") id: string,
		@Request() req: { user: { id: number } },
	): Promise<ReplaySummaryView> {
		return this.replayService.saveForUser(id, req.user);
	}

	@Delete(":id/replay/save")
	unsaveReplay(
		@Param("id") id: string,
		@Request() req: { user: { id: number } },
	): Promise<ReplaySummaryView> {
		return this.replayService.unsaveForUser(id, req.user.id);
	}
}
