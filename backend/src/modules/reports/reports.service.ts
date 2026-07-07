import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
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
	 * product decision, see docs/SOCIAL_TAB_HANDOFF.md §4).
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
			// Report insert + auto-block run in one transaction so we never end up
			// with a report row but no block (or vice versa).
			await this.reportRepo.manager.transaction(async (em) => {
				const repo = em.getRepository(Report);
				await repo.save(
					repo.create({
						reporterId,
						reportedId,
						category,
						message: message ?? null,
					}),
				);
				await this.friendsService.block(reporterId, reportedId, em);
			});
		} catch (err) {
			// Preserve typed exceptions (e.g. block's NotFound for a missing
			// target — Bug Audit M3 — or its InternalServerError); wrap anything
			// else as a generic report failure.
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException ||
				err instanceof InternalServerErrorException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to submit report");
		}
	}
}
