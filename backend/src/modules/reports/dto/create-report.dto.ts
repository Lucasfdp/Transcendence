import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";
import { ReportCategory } from "../entities/report.entity";

export const REPORT_CATEGORIES: ReportCategory[] = [
	"harassment",
	"cheating",
	"inappropriate_name",
	"spam",
	"other",
];

/** Cap free-text report messages to keep abuse reports skimmable for moderators. */
const REPORT_MESSAGE_MAX_LENGTH = 500;

export class CreateReportDto {
	@IsInt()
	@IsPositive()
	reportedId: number;

	@IsEnum(REPORT_CATEGORIES)
	category: ReportCategory;

	@IsOptional()
	@IsString()
	@MaxLength(REPORT_MESSAGE_MAX_LENGTH)
	message?: string;
}
