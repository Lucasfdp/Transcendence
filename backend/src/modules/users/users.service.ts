import {
	ConflictException,
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

@Injectable()
export class UsersService {
	constructor(
		@InjectRepository(User) private readonly usersRepo: Repository<User>,
		@InjectRepository(Profile)
		private readonly profilesRepo: Repository<Profile>,
		@Inject(forwardRef(() => ShellsService))
		private readonly shellsService: ShellsService,
	) {}

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

	async findByGithubId(githubId: string): Promise<User | null> {
		try {
			return await this.usersRepo.findOne({
				where: { githubId },
				relations: ["profile"],
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to find user by GitHub id",
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
		githubId?: string | null;
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
	 * `turtleName` lives on the User row; `bio` lives on the linked Profile row.
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
			if (dto.bio !== undefined && user.profile) {
				user.profile.bio = dto.bio;
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
				err instanceof InternalServerErrorException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to update profile");
		}
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
}
