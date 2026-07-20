import {
	Injectable,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";
import { lockUserForUpdate } from "../users/user-lock.util";
import { Profile } from "../profiles/entities/profile.entity";
import { AchievementView } from "../achievements/achievements.constants";
import { AchievementsService } from "../achievements/achievements.service";
import { CardsService } from "../cards/cards.service";
import { type PackPull } from "../cards/cards.constants";
import { SubmitResultDto } from "./dto/submit-result.dto";
import { UserGameStats } from "./entities/user-game-stats.entity";
import {
	COINS_PER_COMPLETED,
	COINS_PER_DRAW,
	COINS_PER_LOSS,
	COINS_PER_WIN,
	XP_PER_COMPLETED,
	XP_PER_DRAW,
	XP_PER_LOSS,
	XP_PER_WIN,
	xpForNextLevel,
} from "./progression.constants";

export interface ProgressionResult {
	xpGained: number;
	coinsGained: number;
	newXp: number;
	newLevel: number;
	newCoins: number;
	leveledUp: boolean;
	unlockedAchievements: AchievementView[];
	/** Cosmetic card awarded for completing the match, or null if none. */
	cardDrop: PackPull | null;
}

@Injectable()
export class GameResultsService {
	private readonly logger = new Logger(GameResultsService.name);

	constructor(
		private readonly usersService: UsersService,
		private readonly achievementsService: AchievementsService,
		private readonly cardsService: CardsService,
		@InjectRepository(UserGameStats)
		private readonly userGameStatsRepo: Repository<UserGameStats>,
	) {}

	async submitResult(
		user: User,
		dto: SubmitResultDto,
	): Promise<ProgressionResult> {
		try {
			const isWin = dto.outcome === "win";
			const isLoss = dto.outcome === "loss";
			const { xpGained, coinsGained } = this.rewardFor(dto.outcome);

			// Bug Audit 1.2: this used to mutate the `user` object the caller
			// happened to have loaded earlier and persist it with a plain
			// `usersService.save(user)` — a read-modify-write with no lock,
			// racing every other wallet writer on the same `users.coins` column
			// (casino spins, card packs, cosmetic purchases) under READ
			// COMMITTED. The loser's XP/coins delta is silently dropped. Lock the
			// row first, exactly like `CasinoEngine.resolveSpin` does, and derive
			// every value below from the freshly-locked row rather than the
			// possibly-stale `user` argument.
			const { current, xp, level, leveledUp } = await this.usersService
				.getDataSource()
				.transaction(async (manager) => {
					const locked = await lockUserForUpdate(manager, user.id);

					// ── XP + level-up (loop handles multiple thresholds at once) ──
					let xp = locked.xp + xpGained;
					let level = locked.level;
					let leveledUp = false;
					while (xp >= xpForNextLevel(level)) {
						xp -= xpForNextLevel(level);
						level += 1;
						leveledUp = true;
					}

					// ── Profile stats ──────────────────────────────────────────
					// `loadEagerRelations: false` (required for the lock, see
					// `lockUserForUpdate`) means `locked.profile` isn't populated —
					// reload it separately, inside the same transaction. Every user
					// is created with a Profile row (see UsersService.create), so a
					// missing row here is an orphaned data-integrity edge case, not
					// a "caller forgot to load the relation" issue anymore. Fail
					// with a clear, actionable error instead of a raw TypeError on
					// the mutation below (Bug Audit L4).
					const profilesRepo = manager.getRepository(Profile);
					const profile = await profilesRepo.findOne({
						where: { user: { id: locked.id } },
					});
					if (!profile) {
						throw new InternalServerErrorException(
							`Cannot submit game result: user ${locked.id} has no profile`,
						);
					}
					if (isWin) profile.totalWins += 1;
					else if (isLoss) profile.totalLosses += 1;
					profile.gamesPlayed += 1;
					profile.totalCoinsEarned =
						(profile.totalCoinsEarned ?? 0) + coinsGained;

					locked.xp = xp;
					locked.level = level;
					locked.coins = locked.coins + coinsGained;
					locked.profile = profile;

					await manager.getRepository(User).save(locked);
					await profilesRepo.save(profile);

					return { current: locked, xp, level, leveledUp };
				});

			await this.updateGameStats(
			current,
			dto.gameId,
			dto.outcome,
			dto.perfectRounds ?? 0,
		);

			const unlockedAchievements =
				await this.achievementsService.evaluateForUser(current);

			// Cosmetic match-completion card drop is best-effort: a failure here
			// must never roll back or block the recorded match progression.
			let cardDrop: PackPull | null = null;
			try {
				cardDrop = await this.cardsService.grantMatchDrop(current);
			} catch (err: unknown) {
				// Bug Audit L3: this failure used to be silently swallowed —
				// a systemic drop failure (e.g. a schema mismatch) would be
				// completely invisible in prod. Log it; still never rethrow,
				// since a cosmetic drop must never block match progression.
				this.logger.warn(
					`grantMatchDrop failed for user ${current.id}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				cardDrop = null;
			}

			// Bug Audit M4: `evaluateForUser` can unlock a coins-reward
			// achievement, which mutates `current.coins` (same object reference)
			// and persists it with its own `usersRepo.save(user)` call. The
			// `coins` value derived above is the match-reward-only balance from
			// *before* that happened, so the response must read `current.coins`
			// now to reflect the final, actually-persisted total — otherwise the
			// client's balance/animation is wrong until the next refetch.
			// TODO(#game-results-atomicity): submitResult persists the user row
			// twice (once here, once inside AchievementsService.applyReward when
			// a coins achievement unlocks). Folding both into a single
			// transaction would remove the extra write without changing
			// behaviour; deferred since it touches AchievementsService's public
			// save path used elsewhere.
			return {
				xpGained,
				coinsGained,
				newXp: xp,
				newLevel: level,
				newCoins: current.coins,
				leveledUp,
				unlockedAchievements,
				cardDrop,
			};
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			throw new InternalServerErrorException(
				"Failed to record game result",
			);
		}
	}

	private rewardFor(outcome: SubmitResultDto["outcome"]): {
		xpGained: number;
		coinsGained: number;
	} {
		if (outcome === "win")
			return { xpGained: XP_PER_WIN, coinsGained: COINS_PER_WIN };
		if (outcome === "loss")
			return { xpGained: XP_PER_LOSS, coinsGained: COINS_PER_LOSS };
		if (outcome === "draw")
			return { xpGained: XP_PER_DRAW, coinsGained: COINS_PER_DRAW };
		return {
			xpGained: XP_PER_COMPLETED,
			coinsGained: COINS_PER_COMPLETED,
		};
	}

	private async updateGameStats(
		user: User,
		gameId: string,
		outcome: SubmitResultDto["outcome"],
		perfectRounds = 0,
	): Promise<void> {
		const stats =
			(await this.userGameStatsRepo.findOne({
				where: { user: { id: user.id }, gameId },
				relations: ["user"],
			})) ??
			this.userGameStatsRepo.create({
				user,
				gameId,
				gamesPlayed: 0,
				totalWins: 0,
				totalLosses: 0,
				perfectRounds: 0,
			});

		stats.gamesPlayed += 1;
		if (outcome === "win") stats.totalWins += 1;
		else if (outcome === "loss") stats.totalLosses += 1;
		stats.perfectRounds = (stats.perfectRounds ?? 0) + perfectRounds;

		await this.userGameStatsRepo.save(stats);
	}
}
