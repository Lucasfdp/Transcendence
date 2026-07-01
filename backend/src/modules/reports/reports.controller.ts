import { Body, Controller, HttpCode, Post, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
	constructor(private readonly reportsService: ReportsService) {}

	/** POST /api/reports — report a user (auto-blocks them). */
	@Post()
	@HttpCode(200)
	async create(
		@Request() req: { user: { id: number } },
		@Body() body: CreateReportDto,
	): Promise<{ ok: boolean }> {
		await this.reportsService.create(
			req.user.id,
			body.reportedId,
			body.category,
			body.message,
		);
		return { ok: true };
	}
}
