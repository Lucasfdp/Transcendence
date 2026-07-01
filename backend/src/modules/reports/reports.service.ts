import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FriendsService } from "../friends/friends.service";
import { Report, ReportCategory } from "./entities/report.entity";

@Injectable()
export class ReportsService {
	constructor(
		@InjectRepository(Report)
		private readonly reportRepo: Repository<Report>,
		private readonly friendsService: FriendsService,
	) {}

	/**
	 * Persist a report and auto-block the reported user.
	 * Reporting always blocks — there is no separate block step (locked
	 * product decision, see SOCIAL_TAB_HANDOFF.md §4).
	 */
	async create(
		reporterId: number,
		reportedId: number,
		category: ReportCategory,
		message?: string,
	): Promise<void> {
		if (reporterId === reportedId) {
			throw new BadRequestException("You cannot report yourself");
		}

		try {
			await this.reportRepo.save(
				this.reportRepo.create({
					reporterId,
					reportedId,
					category,
					message: message ?? null,
				}),
			);
		} catch {
			throw new InternalServerErrorException("Failed to submit report");
		}

		// Let FriendsService.block's own typed exceptions propagate as-is.
		await this.friendsService.block(reporterId, reportedId);
	}
}
