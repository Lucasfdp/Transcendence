import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ACHIEVEMENTS } from "../achievements/achievements.constants";
import { UserAchievement } from "../achievements/entities/user-achievement.entity";
import { User } from "../users/entities/user.entity";
import {
	COSMETICS,
	CosmeticDefinition,
	CosmeticView,
	findCosmetic,
} from "./customization.constants";
import { UserCosmetic } from "./entities/user-cosmetic.entity";

@Injectable()
export class CustomizationService {
	constructor(
		@InjectRepository(UserCosmetic)
		private readonly userCosmeticsRepo: Repository<UserCosmetic>,
		@InjectRepository(UserAchievement)
		private readonly userAchievementsRepo: Repository<UserAchievement>,
		@InjectRepository(User)
		private readonly usersRepo: Repository<User>,
		private readonly dataSource: DataSource,
	) {
		this.validateAchievementCosmeticRewards();
	}

	async listForUser(user: User): Promise<CosmeticView[]> {
		const ownedIds = await this.findOwnedIds(user.id);
		const achievementIds = await this.findAchievementIds(user.id);
		return this.toViews(user, ownedIds, achievementIds);
	}

	async equip(user: User, cosmeticId: string): Promise<CosmeticView[]> {
		const cosmetic = this.requireCosmetic(cosmeticId);

		const ownedIds = await this.findOwnedIds(user.id);
		if (!this.isOwned(cosmetic, ownedIds))
			throw new ForbiddenException("Cosmetic is not owned");

		if (cosmetic.type === "shell_skin") user.shellSkin = cosmetic.id;
		else if (cosmetic.type === "hub_background")
			user.hubBackground = cosmetic.id;
		else throw new BadRequestException("Cosmetic is not equippable");

		await this.usersRepo.save(user);
		const achievementIds = await this.findAchievementIds(user.id);
		return this.toViews(user, ownedIds, achievementIds);
	}

	async buy(user: User, cosmeticId: string): Promise<CosmeticView[]> {
		const cosmetic = this.requireCosmetic(cosmeticId);
		if (cosmetic.defaultUnlocked)
			throw new BadRequestException("Default cosmetics cannot be bought");

		return this.dataSource.transaction(async (manager) => {
			const usersRepo = manager.getRepository(User);
			const cosmeticsRepo = manager.getRepository(UserCosmetic);
			const achievementsRepo = manager.getRepository(UserAchievement);

			const currentUser = await usersRepo.findOne({
				where: { id: user.id },
				relations: ["profile"],
			});
			if (!currentUser) throw new ForbiddenException("User not found");

			const ownedIds = await this.findOwnedIds(
				currentUser.id,
				cosmeticsRepo,
			);
			const achievementIds = await this.findAchievementIds(
				currentUser.id,
				achievementsRepo,
			);
			if (this.isOwned(cosmetic, ownedIds))
				return this.toViews(currentUser, ownedIds, achievementIds);

			if (cosmetic.unlockAchievementId) {
				if (!achievementIds.has(cosmetic.unlockAchievementId)) {
					throw new ForbiddenException(
						"Cosmetic is locked by achievement",
					);
				}
			}

			if (currentUser.coins < cosmetic.price)
				throw new BadRequestException("Not enough coins");

			currentUser.coins -= cosmetic.price;
			await usersRepo.save(currentUser);
			await this.grantCosmetic(currentUser, cosmetic.id, cosmeticsRepo);

			ownedIds.add(cosmetic.id);
			return this.toViews(currentUser, ownedIds, achievementIds);
		});
	}

	async grantCosmetic(
		user: User,
		cosmeticId: string,
		repo: Repository<UserCosmetic> = this.userCosmeticsRepo,
	): Promise<void> {
		this.requireCosmetic(cosmeticId);
		try {
			await repo.save(repo.create({ user, cosmeticId }));
		} catch (err: unknown) {
			if ((err as { code?: string })?.code === "23505") return;
			throw new InternalServerErrorException("Failed to unlock cosmetic");
		}
	}

	private async findOwnedIds(
		userId: number,
		repo: Repository<UserCosmetic> = this.userCosmeticsRepo,
	): Promise<Set<string>> {
		const rows = await repo.find({
			where: { user: { id: userId } },
			relations: ["user"],
		});
		return new Set(rows.map((row) => row.cosmeticId));
	}

	private async findAchievementIds(
		userId: number,
		repo: Repository<UserAchievement> = this.userAchievementsRepo,
	): Promise<Set<string>> {
		const rows = await repo.find({
			where: { user: { id: userId } },
			relations: ["user"],
		});
		return new Set(rows.map((row) => row.achievementId));
	}

	private requireCosmetic(cosmeticId: string): CosmeticDefinition {
		const cosmetic = findCosmetic(cosmeticId);
		if (!cosmetic) throw new NotFoundException("Cosmetic not found");
		return cosmetic;
	}

	private isOwned(
		cosmetic: CosmeticDefinition,
		ownedIds: Set<string>,
	): boolean {
		return cosmetic.defaultUnlocked === true || ownedIds.has(cosmetic.id);
	}

	private toViews(
		user: User,
		ownedIds: Set<string>,
		achievementIds: Set<string>,
	): CosmeticView[] {
		return COSMETICS.map((cosmetic) => {
			const owned = this.isOwned(cosmetic, ownedIds);
			const lockedReason = this.lockedReason(
				user,
				cosmetic,
				owned,
				achievementIds,
			);
			return {
				...cosmetic,
				owned,
				equipped: this.isEquipped(user, cosmetic),
				...(cosmetic.unlockAchievementId
					? {
							unlockRequirement: {
								type: "achievement" as const,
								achievementId: cosmetic.unlockAchievementId,
							},
						}
					: {}),
				...(lockedReason ? { lockedReason } : {}),
			};
		});
	}

	private isEquipped(user: User, cosmetic: CosmeticDefinition): boolean {
		if (cosmetic.type === "shell_skin")
			return (user.shellSkin ?? "kanagawa") === cosmetic.id;
		if (cosmetic.type === "hub_background")
			return (user.hubBackground ?? "default_dojo") === cosmetic.id;
		return false;
	}

	private lockedReason(
		user: User,
		cosmetic: CosmeticDefinition,
		owned: boolean,
		achievementIds: Set<string>,
	): CosmeticView["lockedReason"] | undefined {
		if (owned) return undefined;
		if (
			cosmetic.unlockAchievementId &&
			!achievementIds.has(cosmetic.unlockAchievementId)
		)
			return "achievement-locked";
		if (user.coins < cosmetic.price) return "not enough coins";
		return "purchasable";
	}

	private validateAchievementCosmeticRewards(): void {
		const missing = ACHIEVEMENTS.filter(
			(achievement) =>
				achievement.reward.type === "cosmetic" &&
				!findCosmetic(achievement.reward.cosmeticId),
		).map(
			(achievement) =>
				`${achievement.id}:${achievement.reward.type === "cosmetic" ? achievement.reward.cosmeticId : ""}`,
		);

		if (missing.length > 0)
			throw new Error(
				`Invalid cosmetic achievement rewards: ${missing.join(", ")}`,
			);
	}
}
