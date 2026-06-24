import {
	BadRequestException,
	Body,
	Controller,
	Get,
	InternalServerErrorException,
	Logger,
	Param,
	Patch,
	Post,
	Query,
	Request,
	UnauthorizedException,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { diskStorage } from "multer";
import { extname } from "path";
import { randomUUID } from "crypto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FriendsService } from "../friends/friends.service";
import { PresenceService } from "../presence/presence.service";
import { User } from "./entities/user.entity";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

// ── Constants ─────────────────────────────────────────────────────────────────
// TODO(#leaderboard-refactor): frontend/src/features/hub/api.ts line 281
// calls GET /api/users (getAllUsers) — migrate that call to
// GET /api/users/leaderboard?period=all and remove the getAllUsers wrapper.
const LEADERBOARD_LIMIT = 50;
const WEEKLY_DAYS = 7;

/** Accepted MIME types for avatar uploads. */
const ALLOWED_IMAGE_MIMES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

/** Max avatar file size: 2 MB. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type LbPeriod = "all" | "monthly" | "weekly";
export type LbScope = "global" | "friends";

export interface LeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	wins: number;
	gamesPlayed: number;
	isOnline: boolean;
}

/**
 * Minimal type for the file object injected by multer's diskStorage.
 * Defined locally to avoid a hard dependency on @types/multer at the module
 * boundary — @nestjs/platform-express already pulls in multer at runtime.
 */
interface MulterFile {
	fieldname: string;
	originalname: string;
	encoding: string;
	mimetype: string;
	size: number;
	destination: string;
	filename: string;
	path: string;
}

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
	private readonly logger = new Logger(UsersController.name);

	constructor(
		private readonly usersService: UsersService,
		private readonly presence: PresenceService,
		private readonly friendsService: FriendsService,
	) {}

	// ── GET /api/users/me ────────────────────────────────────────────────────────

	@Get("me")
	async getMe(
		@Request() req: { user: { id: number } },
	): Promise<Omit<User, "passwordHash">> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();
		const { passwordHash: _pw, ...safe } = user as User & {
			passwordHash?: unknown;
		};
		void _pw;
		return safe as Omit<User, "passwordHash">;
	}

	// ── PATCH /api/users/me ──────────────────────────────────────────────────────

	@Patch("me")
	updateMe(
		@Request() req: { user: { id: number } },
		@Body() dto: UpdateProfileDto,
	): Promise<User> {
		return this.usersService.updateProfile(req.user.id, dto);
	}

	// ── POST /api/users/me/avatar ────────────────────────────────────────────────
	//
	// Accepts a single multipart file under the field name "avatar".
	// Writes to ./uploads/avatars/ (mounted as a Docker volume).
	// Nginx serves /uploads/ as a static directory —
	// see infra/reverse-proxy/conf/default.conf.template

	@Post("me/avatar")
	@UseInterceptors(
		FileInterceptor("avatar", {
			storage: diskStorage({
				destination: "./uploads/avatars",
				filename: (_req, file, cb) => {
					const ext = extname(file.originalname);
					cb(null, `${randomUUID()}${ext}`);
				},
			}),
			limits: { fileSize: AVATAR_MAX_BYTES },
			fileFilter: (_req, file, cb) => {
				cb(
					null,
					(ALLOWED_IMAGE_MIMES as readonly string[]).includes(
						file.mimetype,
					),
				);
			},
		}),
	)
	uploadAvatar(
		@Request() req: { user: { id: number } },
		@UploadedFile() file: MulterFile,
	): Promise<{ avatarUrl: string }> {
		if (!file) {
			throw new BadRequestException(
				"No valid image file provided. Accepted types: JPEG, PNG, WebP, GIF. Max size: 2 MB.",
			);
		}
		return this.usersService.updateAvatar(req.user.id, file.filename);
	}

	// ── GET /api/users/leaderboard ───────────────────────────────────────────────
	//
	// Query params:
	//   period — 'all' (default) | 'monthly' | 'weekly'
	//   scope  — 'global' (default) | 'friends'
	//
	// 'all'     → fast SQL path against profiles.totalWins (no match join needed)
	// 'monthly' → counts wins in match_players for the current calendar month
	// 'weekly'  → counts wins in match_players for the last 7 days
	//
	// Declared BEFORE :username so NestJS does not route the literal string
	// 'leaderboard' into the :username param handler.

	@Get("leaderboard")
	@ApiQuery({
		name: "period",
		required: false,
		enum: ["all", "monthly", "weekly"],
	})
	@ApiQuery({ name: "scope", required: false, enum: ["global", "friends"] })
	async getLeaderboard(
		@Request() req: { user: { id: number; isGuest: boolean } },
		@Query("period") period: LbPeriod = "all",
		@Query("scope") scope: LbScope = "global",
	): Promise<LeaderboardEntry[]> {
		try {
			const validPeriods: LbPeriod[] = ["all", "monthly", "weekly"];
			const validScopes: LbScope[] = ["global", "friends"];
			const safePeriod: LbPeriod = validPeriods.includes(period)
				? period
				: "all";
			const safeScope: LbScope = validScopes.includes(scope)
				? scope
				: "global";

			// For scope=friends, collect the caller's friend IDs (+ self)
			let allowedIds: number[] | null = null;
			if (safeScope === "friends") {
				const friendIds = await this.friendsService.getFriendIds(
					req.user.id,
				);
				allowedIds = [...friendIds, req.user.id];
			}

			const rows =
				safePeriod === "all"
					? await this.usersService.getLeaderboardAllTime(
							LEADERBOARD_LIMIT,
							allowedIds,
						)
					: await this.queryPeriod(safePeriod, allowedIds);

			return rows.map((row, idx) => ({
				rank: idx + 1,
				userId: Number(row.userId),
				username: row.username as string,
				turtleName: (row.turtleName as string | null) ?? null,
				shellSkin: row.shellSkin as string,
				avatar: (row.avatar as string | null) ?? null,
				level: Number(row.level),
				wins: Number(row.wins),
				gamesPlayed: Number(row.gamesPlayed),
				isOnline: this.presence.isOnline(Number(row.userId)),
			}));
		} catch (err) {
			this.logger.error(
				`Leaderboard query failed [period=${period} scope=${scope}]: ${String(err)}`,
				err instanceof Error ? err.stack : undefined,
			);
			throw new InternalServerErrorException(
				"Failed to load leaderboard",
			);
		}
	}

	// ── GET /api/users/:username ─────────────────────────────────────────────────

	@Get(":username")
	async getUser(
		@Param("username") username: string,
	): Promise<(Omit<User, "passwordHash"> & { isOnline: boolean }) | null> {
		const user = await this.usersService.findByUsername(username);
		if (!user) return null;
		const { passwordHash: _pw, ...safe } = user as User & {
			passwordHash?: unknown;
		};
		void _pw;
		return {
			...(safe as Omit<User, "passwordHash">),
			isOnline: this.presence.isOnline(user.id),
		};
	}

	// ── Private query helpers ────────────────────────────────────────────────────

	/**
	 * Period-filtered leaderboard using match history.
	 * Counts only wins (mp.outcome = 'win') from matches created within the
	 * requested time window.  Uses a left join so players with zero period wins
	 * still appear, sorted to the bottom.
	 */
	private async queryPeriod(
		period: "monthly" | "weekly",
		allowedIds: number[] | null,
	): Promise<Record<string, unknown>[]> {
		const cutoff =
			period === "weekly"
				? new Date(Date.now() - WEEKLY_DAYS * 24 * 60 * 60 * 1000)
				: (() => {
						const d = new Date();
						d.setDate(1);
						d.setHours(0, 0, 0, 0);
						return d;
					})();

		const params: unknown[] = [cutoff, LEADERBOARD_LIMIT];
		let idFilter = "";
		if (allowedIds !== null) {
			params.push(allowedIds);
			idFilter = `AND u.id = ANY($${params.length})`;
		}

		// NOTE: TypeORM's default naming strategy keeps camelCase column names in
		// PostgreSQL (no snake_case conversion).  All identifiers here must match
		// what TypeORM actually created in the DB (confirmed from schema logs).
		return this.usersService
			.getDataSource()
			.query<Record<string, unknown>[]>(
				`
      SELECT
        u.id                                                               AS "userId",
        u.username,
        u."turtleName",
        u."shellSkin",
        u.avatar,
        u.level,
        COALESCE(SUM(
          CASE WHEN mp.outcome = 'win' THEN 1 ELSE 0 END
        ), 0)::int                                                          AS wins,
        COALESCE(COUNT(mp.id), 0)::int                                      AS "gamesPlayed"
      FROM users u
      LEFT JOIN match_players mp ON mp."userId" = u.id
      LEFT JOIN matches       m  ON m.id = mp."matchId"
                                AND m."createdAt" >= $1
      WHERE u."isGuest" = false
        ${idFilter}
      GROUP BY u.id
      ORDER BY wins DESC, u.level DESC, u.username ASC
      LIMIT $2
    `,
				params,
			);
	}
}
