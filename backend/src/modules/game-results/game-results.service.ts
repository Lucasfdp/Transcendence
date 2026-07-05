import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";
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

			// ── XP + level-up (loop handles multiple thresholds in a single call) ──
			let xp = user.xp + xpGained;
			let level = user.level;
			let leveledUp = false;

			while (xp >= xpForNextLevel(level)) {
				xp -= xpForNextLevel(level);
				level += 1;
				leveledUp = true;
			}

			// ── Coins ──────────────────────────────────────────────────────────────
			const coins = user.coins + coinsGained;

			// ── Profile stats ──────────────────────────────────────────────────────
			// Every user is created with a Profile row (see UsersService.create), so
			// a missing `profile` here means the caller loaded the user without the
			// relation, or the row is an orphaned data-integrity edge case (partial
			// migration). Fail with a clear, actionable error instead of a raw
			// TypeError on the mutation below (Bug Audit L4).
			const profile = user.profile;
			if (!profile) {
				throw new InternalServerErrorException(
					`Cannot submit game result: user ${user.id} has no profile loaded`,
				);
			}
			if (isWin) {
				profile.totalWins += 1;
			} else if (isLoss) {
				profile.totalLosses += 1;
			}
			profile.gamesPlayed += 1;
			profile.totalCoinsEarned =
				(profile.totalCoinsEarned ?? 0) + coinsGained;

			// ── Persist atomically via cascade save ───────────────────────────────
			// usersRepo.save(user) with cascade:true on the profile OneToOne
			// updates both rows in a single transaction.
			user.xp = xp;
			user.level = level;
			user.coins = coins;
			user.profile = profile;

			await this.usersService.save(user);

			await this.updateGameStats(user, dto.gameId, dto.outcome);

			const unlockedAchievements =
				await this.achievementsService.evaluateForUser(user);

			// Cosmetic match-completion card drop is best-effort: a failure here
			// must never roll back or block the recorded match progression.
			let cardDrop: PackPull | null = null;
			try {
				cardDrop = await this.cardsService.grantMatchDrop(user);
			} catch {
				cardDrop = null;
			}

			// Bug Audit M4: `evaluateForUser` can unlock a coins-reward
			// achievement, which mutates `user.coins` (same object reference)
			// and persists it with its own `usersRepo.save(user)` call. The
			// local `coins` const captured above is the match-reward-only
			// balance from *before* that happened, so the response must read
			// `user.coins` now to reflect the final, actually-persisted total —
			// otherwise the client's balance/animation is wrong until the next
			// refetch.
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
				newCoins: user.coins,
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
			});

		stats.gamesPlayed += 1;
		if (outcome === "win") stats.totalWins += 1;
		else if (outcome === "loss") stats.totalLosses += 1;

		await this.userGameStatsRepo.save(stats);
	}
}
