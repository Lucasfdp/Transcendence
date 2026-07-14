import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	forwardRef,
	Inject,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { Profile } from "../profiles/entities/profile.entity";
import { ShellsService } from "../shells/shells.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { findCosmetic } from "../customization/customization.constants";
import { UserCosmetic } from "../customization/entities/user-cosmetic.entity";

@Injectable()
export class UsersService {
	constructor(
		@InjectRepository(User) private readonly usersRepo: Repository<User>,
		@InjectRepository(Profile)
		private readonly profilesRepo: Repository<Profile>,
		@InjectRepository(UserCosmetic)
		private readonly userCosmeticsRepo: Repository<UserCosmetic>,
		@Inject(forwardRef(() => ShellsService))
		private readonly shellsService: ShellsService,
	) {}

	/**
	 * Record that the user was last seen at `when` (defaults to now).
	 * Called when a user's last socket disconnects so offline friends can show
	 * a "last online" time. Uses a targeted UPDATE — no full entity load.
	 */
	async markSeen(userId: number, when: Date = new Date()): Promise<void> {
		try {
			await this.usersRepo.update({ id: userId }, { lastSeenAt: when });
		} catch {
			throw new InternalServerErrorException(
				"Failed to update last-seen timestamp",
			);
		}
	}

	async findById(id: number): Promise<User | null> {
		try {
			return await this.usersRepo.findOne({
				where: { id },
				relations: ["profile"],
			});
		} catch {
			throw new InternalServerErrorException(
				`Failed to find user by id ${id}`,
			);
		}
	}

	async findByFortyTwoId(fortyTwoId: string): Promise<User | null> {
		try {
			return await this.usersRepo.findOne({
				where: { fortyTwoId },
				relations: ["profile"],
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to find user by 42 id",
			);
		}
	}

	async findByGoogleId(googleId: string): Promise<User | null> {
		try {
			return await this.usersRepo.findOne({
				where: { googleId },
				relations: ["profile"],
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to find user by Google id",
			);
		}
	}

	/**
	 * Returns the user with that username, or null if none exists.
	 * Includes the passwordHash field (excluded from normal SELECT by `select: false`).
	 * Callers that need to verify credentials must go through AuthService — never
	 * expose passwordHash in HTTP responses.
	 */
	async findByUsername(username: string): Promise<User | null> {
		try {
			return (
				(await this.usersRepo
					.createQueryBuilder("user")
					.addSelect("user.passwordHash") // opt-in: column is select:false by default
					.leftJoinAndSelect("user.profile", "profile")
					.where("user.username = :username", { username })
					.getOne()) ?? null
			);
		} catch {
			throw new InternalServerErrorException(
				"Failed to find user by username",
			);
		}
	}

	async findByEmail(email: string): Promise<User | null> {
		try {
			return await this.usersRepo.findOne({
				where: { email },
				relations: ["profile"],
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to find user by email",
			);
		}
	}

	async create(data: {
		fortyTwoId?: string | null;
		googleId?: string | null;
		username: string;
		email?: string | null;
		avatar?: string;
		passwordHash?: string | null;
		isGuest?: boolean;
		isDevAccount?: boolean;
	}): Promise<User> {
		try {
			const profile = this.profilesRepo.create();
			const savedProfile = await this.profilesRepo.save(profile);
			const user = this.usersRepo.create({
				...data,
				profile: savedProfile,
			});
			const savedUser = await this.usersRepo.save(user);
			// Seed 999 of every shell for the new user.
			// Non-fatal: if this fails the user is still created successfully.
			await this.shellsService.seedInventory(savedUser);
			return savedUser;
		} catch (err: unknown) {
			// PostgreSQL unique-violation on username (or any other unique column).
			// TypeORM wraps the driver error but preserves the original `code`.
			// We surface this as 409 so the frontend friendlyError() handler fires
			// and the user sees "That username is already taken." instead of a 500.
			if ((err as { code?: string })?.code === "23505") {
				throw new ConflictException("Username is already taken");
			}
			throw new InternalServerErrorException("Failed to create user");
		}
	}

	async save(user: User): Promise<User> {
		try {
			return await this.usersRepo.save(user);
		} catch {
			throw new InternalServerErrorException("Failed to save user");
		}
	}

	async saveProfile(profile: Profile): Promise<Profile> {
		try {
			return await this.profilesRepo.save(profile);
		} catch {
			throw new InternalServerErrorException("Failed to save profile");
		}
	}

	async findAll(): Promise<User[]> {
		try {
			return await this.usersRepo.find({ relations: ["profile"] });
		} catch {
			throw new InternalServerErrorException("Failed to fetch users");
		}
	}

	/**
	 * Expose the underlying TypeORM DataSource for callers that need to run raw
	 * SQL queries (e.g. period-filtered leaderboard with match_players join).
	 * Avoids requiring @InjectDataSource() in every controller that imports this
	 * service — the DataSource is already wired up here via the repository.
	 */
	getDataSource() {
		return this.usersRepo.manager.connection;
	}

	/**
	 * Hard-delete all guest accounts whose updatedAt is older than `olderThanMs`
	 * milliseconds. Called by the guest-cleanup cron job.
	 * Returns the count of deleted records.
	 */
	async deleteOldGuests(olderThanMs: number): Promise<number> {
		try {
			const cutoff = new Date(Date.now() - olderThanMs);
			const result = await this.usersRepo.delete({
				isGuest: true,
				updatedAt: LessThan(cutoff),
			});
			return result.affected ?? 0;
		} catch {
			throw new InternalServerErrorException(
				"Failed to delete old guest users",
			);
		}
	}

	/**
	 * All-time leaderboard via a single SQL query against the pre-aggregated
	 * profiles table — no in-memory sort or full table scan on users.
	 * Mirrors the shape returned by queryPeriod so the controller mapping is
	 * identical for all period values.
	 *
	 * @param limit     Maximum number of rows to return (default LEADERBOARD_LIMIT).
	 * @param allowedIds When non-null, restricts results to this set of user IDs
	 *                   (used for scope=friends leaderboards).
	 */
	async getLeaderboardAllTime(
		limit: number,
		allowedIds: number[] | null,
	): Promise<Record<string, unknown>[]> {
		try {
			const params: unknown[] = [limit];
			let idFilter = "";
			if (allowedIds !== null) {
				params.push(allowedIds);
				idFilter = `AND u.id = ANY($${params.length})`;
			}

			// NOTE: TypeORM's default naming strategy keeps camelCase column names —
			// profile FK column in the profiles table is "userId" (not user_id).
			return await this.getDataSource().query<Record<string, unknown>[]>(
				`
        SELECT
          u.id                              AS "userId",
          u.username,
          u."turtleName",
          u."shellSkin",
          u.avatar,
          u.level,
          COALESCE(p."totalWins", 0)::int   AS wins,
          COALESCE(p."gamesPlayed", 0)::int AS "gamesPlayed"
        FROM users u
        LEFT JOIN profiles p ON p."userId" = u.id
        WHERE u."isGuest" = false
          ${idFilter}
        ORDER BY wins DESC, u.level DESC, u.username ASC
        LIMIT $1
        `,
				params,
			);
		} catch {
			throw new InternalServerErrorException(
				"Failed to load all-time leaderboard",
			);
		}
	}

	/**
	 * Update mutable profile fields for the given user.
	 * Only fields present in the DTO are written — undefined keys are skipped.
	 * `turtleName` lives on the User row; `tag` and `showcasedAchievements`
	 * live on the linked Profile row.
	 * Returns the updated user (passwordHash excluded via select:false on the column).
	 */
	async updateProfile(userId: number, dto: UpdateProfileDto): Promise<User> {
		try {
			const user = await this.findById(userId);
			if (!user) {
				throw new NotFoundException(`User ${userId} not found`);
			}

			if (dto.turtleName !== undefined) {
				user.turtleName = dto.turtleName;
			}
			if (user.profile) {
				if (dto.tag !== undefined) {
					if (dto.tag !== null) await this.assertTagOwned(user.id, dto.tag);
					user.profile.tag = dto.tag ?? null;
				}
				if (dto.showcasedAchievements !== undefined) {
					user.profile.showcasedAchievements =
						dto.showcasedAchievements.length > 0
							? dto.showcasedAchievements
							: null;
				}
			}

			await this.usersRepo.save(user);

			// Re-fetch so the returned entity reflects DB state and excludes
			// passwordHash (select:false guarantees it stays out of findOne results).
			const updated = await this.findById(userId);
			if (!updated) {
				throw new InternalServerErrorException(
					"User disappeared after profile update",
				);
			}
			return updated;
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof InternalServerErrorException ||
				err instanceof BadRequestException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to update profile");
		}
	}

	private async assertTagOwned(userId: number, tagId: string): Promise<void> {
		const cosmetic = findCosmetic(tagId);
		if (!cosmetic || cosmetic.type !== "dojo_tag") {
			throw new BadRequestException("Invalid dojo tag");
		}
		if (cosmetic.defaultUnlocked) return;

		const owned = await this.userCosmeticsRepo.exists({
			where: { user: { id: userId }, cosmeticId: tagId },
			relations: ["user"],
		});
		if (!owned) throw new ForbiddenException("Dojo tag is not unlocked");
	}

	/**
	 * Persist a newly-uploaded avatar filename and return the public URL.
	 * The filename is the UUID-prefixed name written to disk by multer's diskStorage.
	 *
	 * Nginx serves /uploads/ as a static directory —
	 * see infra/reverse-proxy/conf/default.conf.template
	 */
	async updateAvatar(
		userId: number,
		filename: string,
	): Promise<{ avatarUrl: string }> {
		try {
			const user = await this.findById(userId);
			if (!user) {
				throw new NotFoundException(`User ${userId} not found`);
			}

			const avatarUrl = `/uploads/avatars/${filename}`;
			user.avatar = avatarUrl;
			await this.usersRepo.save(user);

			return { avatarUrl };
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof InternalServerErrorException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to update avatar");
		}
	}

	/**
	 * Derive the player's most-played game from their per-game stats.
	 *
	 * Tiebreaker order (all ascending where lower = loses):
	 *   1. Highest gamesPlayed
	 *   2. Highest win rate (totalWins / gamesPlayed)
	 *   3. Alphabetical by gameId
	 *
	 * Returns null if the player has not completed any games yet.
	 */
	async getMostPlayedGame(userId: number): Promise<MostPlayedGame | null> {
		try {
			const rows = await this.getDataSource().query<
				{ gameId: string; gamesPlayed: string; totalWins: string }[]
			>(
				`
        SELECT "gameId", "gamesPlayed", "totalWins"
        FROM   user_game_stats
        WHERE  "userId" = $1
          AND  "gamesPlayed" > 0
        ORDER BY
          "gamesPlayed" DESC,
          CASE WHEN "gamesPlayed" > 0
               THEN "totalWins"::float / "gamesPlayed"
               ELSE 0
          END DESC,
          "gameId" ASC
        LIMIT 1
      `,
				[userId],
			);

			if (rows.length === 0) return null;

			const row = rows[0];
			const gamesPlayed = Number(row.gamesPlayed);
			const totalWins = Number(row.totalWins);

			return {
				gameId: row.gameId,
				gameName: GAME_NAMES[row.gameId] ?? row.gameId,
				gamesPlayed,
				winRate:
					gamesPlayed > 0
						? Math.round((totalWins / gamesPlayed) * 100)
						: 0,
			};
		} catch {
			throw new InternalServerErrorException(
				"Failed to derive most played game",
			);
		}
	}
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MostPlayedGame {
	gameId: string;
	gameName: string;
	gamesPlayed: number;
	/** Win rate as an integer percentage (0–100). */
	winRate: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const GAME_NAMES: Record<string, string> = {
	"kame-knock": "Kame Knock",
	"bamboo-bash": "Bamboo Bash",
	"bell-clash": "Bell Clash",
	"temple-curling": "Temple Curling",
};
