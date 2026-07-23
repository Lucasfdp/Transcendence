import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";
import { AccountLinkConflict } from "./entities/account-link-conflict.entity";
import { AuthIdentity, type AuthMethod } from "./entities/auth-identity.entity";
import { hashPassword, verifyPassword } from "./password.util";
import type {
	AccountPreview,
	VerifiedOAuthIdentity,
} from "./account-links.types";
import { UserAccountActivityService } from "../users/user-account-activity.service";

const EXISTING_CONFLICT_MESSAGE =
	"Resolve the existing account conflict before linking another account.";

@Injectable()
export class AccountLinksService {
	constructor(
		@InjectRepository(AuthIdentity)
		private readonly identities: Repository<AuthIdentity>,
		@InjectRepository(AccountLinkConflict)
		private readonly conflicts: Repository<AccountLinkConflict>,
		private readonly usersService: UsersService,
		private readonly dataSource: DataSource,
		private readonly accountActivity: UserAccountActivityService,
	) {}

	async migrateLegacyIdentities(): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await manager.query(`
				INSERT INTO "auth_identities" ("userId", "method", "shellUsername", "shellEmail", "passwordHash")
				SELECT id, 'shellsmash', username, LOWER(email), "passwordHash"
				FROM users WHERE "passwordHash" IS NOT NULL ON CONFLICT DO NOTHING
			`);
			await manager.query(`
				INSERT INTO "auth_identities" ("userId", "method", "providerSubject")
				SELECT id, 'google', "googleId" FROM users WHERE "googleId" IS NOT NULL
				ON CONFLICT DO NOTHING
			`);
			await manager.query(`
				INSERT INTO "auth_identities" ("userId", "method", "providerSubject")
				SELECT id, 'forty_two', "fortyTwoId" FROM users WHERE "fortyTwoId" IS NOT NULL
				ON CONFLICT DO NOTHING
			`);
		});
	}

	async list(userId: number) {
		const canonicalId = await this.usersService.resolveCanonicalUserId(userId);
		const identities = await this.identities.find({
			where: { userId: canonicalId },
			order: { method: "ASC" },
		});
		const conflict = await this.findPendingConflict(canonicalId);
		const user = await this.usersService.findById(canonicalId);
		return {
			prefill: {
				username: user?.username ?? "",
				email: user?.email ?? "",
			},
			methods: (["shellsmash", "forty_two"] as AuthMethod[]).map(
				(method) => ({
					method,
					linked: identities.some((identity) => identity.method === method),
				}),
			),
			conflict: conflict ? await this.conflictView(conflict) : null,
		};
	}

	async createShellsmash(
		userId: number,
		username: string,
		email: string,
		password: string,
	): Promise<void> {
		await this.assertNoPendingConflict(userId);
		const canonicalId = await this.usersService.resolveCanonicalUserId(userId);
		if (await this.findIdentity(canonicalId, "shellsmash")) return;
		const normalizedEmail = email.trim().toLowerCase();
		const duplicate = await this.identities
			.createQueryBuilder("identity")
			.where("identity.shellUsername = :username", { username })
			.orWhere("LOWER(identity.shellEmail) = :email", {
				email: normalizedEmail,
			})
			.getOne();
		if (duplicate) {
			throw new ConflictException(
				"Username or email already exists. Use Link existing account.",
			);
		}
		const identity = this.identities.create({
			userId: canonicalId,
			method: "shellsmash",
			providerSubject: null,
			shellUsername: username,
			shellEmail: normalizedEmail,
			passwordHash: await hashPassword(password),
		});
		try {
			await this.identities.save(identity);
		} catch (error) {
			if ((error as { code?: string }).code === "23505") {
				throw new ConflictException(
					"Username or email already exists. Use Link existing account.",
				);
			}
			throw error;
		}
	}

	async assertCanStart(userId: number): Promise<void> {
		await this.assertNoPendingConflict(
			await this.usersService.resolveCanonicalUserId(userId),
		);
	}

	async linkExistingShellsmash(
		userId: number,
		identifier: string,
		password: string,
	): Promise<{ conflict: boolean }> {
		await this.assertNoPendingConflict(userId);
		const canonicalId = await this.usersService.resolveCanonicalUserId(userId);
		const identity = await this.identities
			.createQueryBuilder("identity")
			.addSelect("identity.passwordHash")
			.where("identity.method = 'shellsmash'")
			.andWhere(
				"(identity.shellUsername = :identifier OR LOWER(identity.shellEmail) = LOWER(:identifier))",
				{ identifier: identifier.trim() },
			)
			.getOne();
		if (!identity || !(await verifyPassword(password, identity.passwordHash))) {
			throw new UnauthorizedException("Invalid email, username or password");
		}
		if (identity.userId === canonicalId) return { conflict: false };
		await this.createConflict(canonicalId, identity.userId, "shellsmash");
		return { conflict: true };
	}

	async completeOAuth(
		identity: VerifiedOAuthIdentity,
		initiatorUserId: number | null,
	): Promise<{ user: User; conflict: boolean }> {
		const existing = await this.identities.findOne({
			where: {
				method: identity.method,
				providerSubject: identity.providerSubject,
			},
		});

		if (initiatorUserId === null) {
			if (existing) {
				const user = await this.usersService.findCanonicalById(existing.userId);
				if (!user) throw new NotFoundException("Account no longer exists");
				return { user, conflict: false };
			}
			const username = await this.makeUniqueUsername(identity.username);
			const existingEmail = identity.email
				? await this.usersService.findByEmail(identity.email)
				: null;
			const user = await this.usersService.create({
				username,
				email: existingEmail ? null : identity.email,
				avatar: identity.avatar ?? undefined,
				isGuest: false,
			});
			await this.identities.save(
				this.identities.create({
					userId: user.id,
					method: identity.method,
					providerSubject: identity.providerSubject,
				}),
			);
			return { user, conflict: false };
		}

		const canonicalId =
			await this.usersService.resolveCanonicalUserId(initiatorUserId);
		await this.assertNoPendingConflict(canonicalId);
		if (!existing) {
			if (await this.findIdentity(canonicalId, identity.method)) {
				throw new ConflictException(
					"This account already has a 42 sign-in method.",
				);
			}
			await this.identities.save(
				this.identities.create({
					userId: canonicalId,
					method: identity.method,
					providerSubject: identity.providerSubject,
				}),
			);
			const user = await this.usersService.findById(canonicalId);
			if (!user) throw new NotFoundException("Account no longer exists");
			return { user, conflict: false };
		}
		if (existing.userId === canonicalId) {
			const user = await this.usersService.findById(canonicalId);
			if (!user) throw new NotFoundException("Account no longer exists");
			return { user, conflict: false };
		}
		await this.createConflict(canonicalId, existing.userId, identity.method);
		const user = await this.usersService.findById(canonicalId);
		if (!user) throw new NotFoundException("Account no longer exists");
		return { user, conflict: true };
	}

	async unlink(userId: number, method: AuthMethod): Promise<void> {
		const canonicalId = await this.usersService.resolveCanonicalUserId(userId);
		await this.unlinkFromUser(canonicalId, method);
	}

	private async unlinkFromUser(userId: number, method: AuthMethod): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows = await manager.find(AuthIdentity, {
				where: { userId },
				lock: { mode: "pessimistic_write" },
			});
			const activeRows = rows.filter((row) => row.method !== "google");
			if (activeRows.length <= 1) {
				throw new BadRequestException(
					"You must keep at least one authentication method.",
				);
			}
			const target = activeRows.find((row) => row.method === method);
			if (target) await manager.remove(target);
		});
	}

	async unlinkDuplicate(
		userId: number,
		conflictId: string,
		side: "current" | "linked",
		method: AuthMethod,
	): Promise<void> {
		const conflict = await this.conflicts.findOne({
			where: { id: conflictId, status: "pending" },
		});
		if (!conflict || conflict.initiatorUserId !== userId) {
			throw new NotFoundException("Account conflict not found");
		}
		const targetUserId =
			side === "current" ? conflict.initiatorUserId : conflict.linkedUserId;
		await this.unlinkFromUser(targetUserId, method);
	}

	async resolve(
		userId: number,
		conflictId: string,
		keep: "initiator" | "linked",
	): Promise<User> {
		return this.dataSource.transaction(async (manager) => {
			const conflict = await manager.findOne(AccountLinkConflict, {
				where: { id: conflictId },
				lock: { mode: "pessimistic_write" },
			});
			if (!conflict || conflict.initiatorUserId !== userId) {
				throw new NotFoundException("Account conflict not found");
			}
			if (conflict.status === "resolved" && conflict.finalUserId) {
				const resolved = await manager.findOne(User, {
					where: { id: conflict.finalUserId },
				});
				if (resolved) return resolved;
			}
			const users = await manager
				.createQueryBuilder(User, "user")
				.setLock("pessimistic_write")
				.where("user.id IN (:...ids)", {
					ids: [conflict.initiatorUserId, conflict.linkedUserId],
				})
				.getMany();
			if (users.length !== 2) throw new NotFoundException("Account not found");

			const active = await manager.query<Array<{ present: boolean }>>(
				`SELECT EXISTS(
					SELECT 1 FROM match_players mp JOIN matches m ON m.id = mp."matchId"
					WHERE mp."userId" = ANY($1) AND m.status IN ('pending', 'active')
				) AS present`,
				[[conflict.initiatorUserId, conflict.linkedUserId]],
			);
			if (
				active[0]?.present ||
				this.accountActivity.isQueued(conflict.initiatorUserId) ||
				this.accountActivity.isQueued(conflict.linkedUserId)
			) {
				throw new ConflictException(
					"Both accounts must leave their queue or match before resolving.",
				);
			}

			const allIdentities = await manager.find(AuthIdentity, {
				where: [
					{ userId: conflict.initiatorUserId },
					{ userId: conflict.linkedUserId },
				],
				lock: { mode: "pessimistic_write" },
			});
			const duplicated = [...new Set(allIdentities.map((row) => row.method))].filter(
				(method) => allIdentities.filter((row) => row.method === method).length > 1,
			);
			if (duplicated.length) {
				throw new ConflictException(
					`Unlink the duplicate ${duplicated.join(", ")} method before continuing.`,
				);
			}

			const keptId =
				keep === "initiator"
					? conflict.initiatorUserId
					: conflict.linkedUserId;
			const discardedId =
				keptId === conflict.initiatorUserId
					? conflict.linkedUserId
					: conflict.initiatorUserId;
			await manager.update(AuthIdentity, { userId: discardedId }, { userId: keptId });
			await this.discardActiveAccountData(manager, discardedId);
			await manager.update(User, { id: discardedId }, {
				mergedIntoUserId: keptId,
				fortyTwoId: null,
				googleId: null,
				passwordHash: null,
				email: null,
				username: `merged_${discardedId}`,
				avatar: null,
				isGuest: true,
			});
			conflict.status = "resolved";
			conflict.resolution = keep;
			conflict.finalUserId = keptId;
			await manager.save(conflict);
			const kept = await manager.findOne(User, { where: { id: keptId } });
			if (!kept) throw new NotFoundException("Final account not found");
			return kept;
		});
	}

	private async discardActiveAccountData(
		manager: EntityManager,
		userId: number,
	): Promise<void> {
		// Moderation, wagers and match history remain attached to the tombstoned
		// user for auditability. User-facing progress and social membership do not.
		await manager.query(`DELETE FROM friendships WHERE "requesterId" = $1 OR "addresseeId" = $1`, [userId]);
		await manager.query(`
			UPDATE conversations c SET "ownerId" = (
				SELECT cp."userId" FROM conversation_participants cp
				WHERE cp."conversationId" = c.id AND cp."userId" <> $1
				ORDER BY cp."joinedAt" ASC, cp.id ASC LIMIT 1
			) WHERE c."ownerId" = $1
		`, [userId]);
		await manager.query(`DELETE FROM conversation_participants WHERE "userId" = $1`, [userId]);
		await manager.query(`DELETE FROM notifications WHERE "fromUserId" = $1 OR "toUserId" = $1`, [userId]);
		for (const [table, column] of [
			["user_cards", "userId"],
			["user_achievements", "userId"],
			["user_cosmetics", "userId"],
			["shell_inventory", "user_id"],
			["user_game_stats", "userId"],
			["user_ratings", "userId"],
			["match_replay_saves", "userId"],
		] as const) {
			await manager.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [userId]);
		}
	}

	private async createConflict(
		initiatorUserId: number,
		linkedUserId: number,
		sourceMethod: AuthMethod,
	): Promise<void> {
		try {
			await this.dataSource.transaction(async (manager) => {
				for (const id of [initiatorUserId, linkedUserId].sort((a, b) => a - b)) {
					await manager.query(`SELECT pg_advisory_xact_lock($1)`, [id]);
				}
				const existing = await manager.findOne(AccountLinkConflict, {
					where: [
						{ initiatorUserId, status: "pending" },
						{ linkedUserId: initiatorUserId, status: "pending" },
						{ initiatorUserId: linkedUserId, status: "pending" },
						{ linkedUserId, status: "pending" },
					],
				});
				if (existing) throw new ConflictException(EXISTING_CONFLICT_MESSAGE);
				await manager.save(AccountLinkConflict, manager.create(AccountLinkConflict, {
					initiatorUserId,
					linkedUserId,
					sourceMethod,
					status: "pending",
					resolution: null,
					finalUserId: null,
				}));
			});
		} catch (error) {
			if (error instanceof ConflictException) throw error;
			if ((error as { code?: string }).code === "23505") {
				throw new ConflictException(EXISTING_CONFLICT_MESSAGE);
			}
			throw error;
		}
	}

	private async assertNoPendingConflict(userId: number): Promise<void> {
		if (await this.findPendingConflict(userId)) {
			throw new ConflictException(EXISTING_CONFLICT_MESSAGE);
		}
	}

	private findPendingConflict(userId: number): Promise<AccountLinkConflict | null> {
		return this.conflicts.findOne({
			where: [
				{ initiatorUserId: userId, status: "pending" },
				{ linkedUserId: userId, status: "pending" },
			],
		});
	}

	private findIdentity(userId: number, method: AuthMethod) {
		return this.identities.findOne({ where: { userId, method } });
	}

	private async conflictView(conflict: AccountLinkConflict) {
		const [current, linked] = await Promise.all([
			this.preview(conflict.initiatorUserId),
			this.preview(conflict.linkedUserId),
		]);
		const duplicateMethods = current.methods.filter((method) =>
			linked.methods.includes(method),
		);
		return {
			id: conflict.id,
			sourceMethod: conflict.sourceMethod,
			labels:
				conflict.sourceMethod === "shellsmash"
					? {
						current: "Current",
						linked: "ShellSmash",
						keepCurrent: "Keep current",
						keepLinked: "Keep ShellSmash",
					}
					: {
						current: "Local",
						linked: "Cloud",
						keepCurrent: "Keep local",
						keepLinked: "Keep cloud",
					},
			current,
			linked,
			duplicateMethods,
		};
	}

	private async preview(userId: number): Promise<AccountPreview> {
		const rows = await this.dataSource.query<Array<Record<string, unknown>>>(`
			SELECT u.id AS "userId", u.avatar, u.username, u."turtleName", u."updatedAt" AS "lastActivity",
				u.level, u.xp, u.coins, COALESCE(p."gamesPlayed", 0)::int AS games,
				(SELECT COUNT(*)::int FROM user_achievements ua WHERE ua."userId" = u.id) AS achievements,
				(SELECT COALESCE(SUM(si.quantity), 0)::int FROM shell_inventory si WHERE si.user_id = u.id) AS inventory,
				(SELECT COUNT(*)::int FROM friendships f WHERE (f."requesterId" = u.id OR f."addresseeId" = u.id) AND f.status = 'accepted') AS friends,
				(SELECT COUNT(*)::int FROM conversation_participants cp WHERE cp."userId" = u.id) AS chats,
				(SELECT COUNT(*)::int FROM match_replay_saves rs WHERE rs."userId" = u.id) AS replays
			FROM users u LEFT JOIN profiles p ON p."userId" = u.id WHERE u.id = $1
		`, [userId]);
		if (!rows[0]) throw new NotFoundException("Account not found");
		const methods = (await this.identities.find({ where: { userId } }))
			.filter((row) => row.method !== "google")
			.map((row) => row.method);
		const row = rows[0];
		return {
			userId: Number(row.userId),
			avatar: (row.avatar as string | null) ?? null,
			username: String(row.username),
			turtleName: (row.turtleName as string | null) ?? null,
			lastActivity: new Date(String(row.lastActivity)).toISOString(),
			level: Number(row.level),
			xp: Number(row.xp),
			coins: Number(row.coins),
			games: Number(row.games),
			achievements: Number(row.achievements),
			inventory: Number(row.inventory),
			friends: Number(row.friends),
			chats: Number(row.chats),
			replays: Number(row.replays),
			methods,
		};
	}

	private async makeUniqueUsername(raw: string): Promise<string> {
		const base = (raw.replace(/[^a-zA-Z0-9_]/g, "_") || "player").slice(0, 20);
		let candidate = base;
		for (let suffix = 2; suffix <= 101; suffix += 1) {
			if (!(await this.usersService.findByUsername(candidate))) return candidate;
			const text = String(suffix);
			candidate = `${base.slice(0, 20 - text.length)}${text}`;
		}
		throw new ConflictException("Could not allocate a unique username");
	}
}
