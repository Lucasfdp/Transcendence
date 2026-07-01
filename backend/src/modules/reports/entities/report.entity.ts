import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/**
 * Report categories the reporter can pick from. Kept as a plain union (not a
 * DB enum type) so adding a category later is a simple migration-free change
 * to this type + the DTO's class-validator enum.
 */
export type ReportCategory =
	| "harassment"
	| "cheating"
	| "inappropriate_name"
	| "spam"
	| "other";

/**
 * A player report. Reporting always auto-blocks the reported user (see
 * ReportsService.create) — there is no separate "block" step for the
 * reporter to take.
 */
@Entity("reports")
@Index(["reportedId"]) // fast lookup for future moderation tooling
@Check('"reporterId" <> "reportedId"') // mirrors chk_no_self_report in the migration
export class Report {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	reporter: User;

	@Column()
	reporterId: number;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	reported: User;

	@Column()
	reportedId: number;

	@Column({ type: "varchar", length: 32 })
	category: ReportCategory;

	/** Optional free-text detail from the reporter. */
	@Column({ type: "text", nullable: true, default: null })
	message: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
