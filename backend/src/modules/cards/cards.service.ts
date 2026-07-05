import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	Injectable,
	InternalServerErrorException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { User } from "../users/entities/user.entity";
import {
	BASIC_PACK_TIER,
	CARDS,
	CARD_FAMILIES,
	DUPLICATE_COIN_REFUND,
	GUARANTEED_SLOT_INDEX,
	PACK_SIZE,
	PACK_TIERS,
	findCard,
	findPackTier,
	type BinderView,
	type CardDefinition,
	type CardSetProgress,
	type CardView,
	type PackPull,
	type PackResult,
	type PackTierId,
} from "./cards.constants";
import {
	type Rng,
	type RolledCard,
	rollCard,
	rollGuaranteedCard,
} from "./cards.roll";
import { UserCard } from "./entities/user-card.entity";

/** Default pack tier opened when a caller doesn't specify one. */
const DEFAULT_PACK_TIER_ID: PackTierId = "basic";

/**
 * Shell Cards service — collectible binder reads and pack opening.
 *
 * Cards are PURELY COSMETIC; nothing here affects gameplay. All randomness and
 * coin spending happen server-side inside a single transaction so a client can
 * never choose its own pulls or double-spend coins.
 */
@Injectable()
export class CardsService {
	constructor(
		@InjectRepository(UserCard)
		private readonly userCardsRepo: Repository<UserCard>,
		private readonly dataSource: DataSource,
	) {}

	/** Build the binder view (owned + locked cards, set progress) for a user. */
	async getBinder(user: User): Promise<BinderView> {
		const ownedByCardId = await this.findOwnedRows(user.id);

		const cards: CardView[] = CARDS.map((card) => {
			const owned = ownedByCardId.get(card.id);
			return {
				...card,
				owned: owned !== undefined,
				count: owned?.count ?? 0,
				foilCount: owned?.foilCount ?? 0,
				prismaticCount: owned?.prismaticCount ?? 0,
			};
		});

		const sets: CardSetProgress[] = CARD_FAMILIES.map((family) => {
			const familyCards = cards.filter((card) => card.family === family);
			return {
				family,
				owned: familyCards.filter((card) => card.owned).length,
				total: familyCards.length,
			};
		});

		const ownedTotal = cards.filter((card) => card.owned).length;

		return {
			cards,
			sets,
			totals: { owned: ownedTotal, total: CARDS.length },
			packTiers: PACK_TIERS,
		};
	}

	/**
	 * Open one pack of the given tier: spend that tier's `priceCoins` and
	 * reveal PACK_SIZE server-rolled cards (the tier's own rarity odds and
	 * foil chance), refunding coins for duplicates. If the tier declares a
	 * `guaranteedMinRarity`, the {@link GUARANTEED_SLOT_INDEX} slot is rolled
	 * via `rollGuaranteedCard` instead of the normal roll. The coin spend and
	 * all grants run in one transaction — if anything fails, nothing is
	 * persisted.
	 *
	 * @param tierId which pack tier to open; defaults to "basic".
	 * @param rng injectable randomness; defaults to Math.random in production.
	 */
	async openPack(
		user: User,
		tierId: PackTierId = DEFAULT_PACK_TIER_ID,
		rng: Rng = Math.random,
	): Promise<PackResult> {
		const tier = findPackTier(tierId);
		if (!tier) throw new BadRequestException(`Unknown pack tier: ${tierId}`);

		try {
			return await this.dataSource.transaction(async (manager) => {
				const usersRepo = manager.getRepository(User);
				const cardsRepo = manager.getRepository(UserCard);

				const current = await usersRepo.findOne({
					where: { id: user.id },
					relations: ["profile"],
				});
				if (!current) throw new ForbiddenException("User not found");
				if (current.coins < tier.priceCoins)
					throw new BadRequestException("Not enough coins");

				current.coins -= tier.priceCoins;

				const pulls: PackPull[] = [];
				for (let i = 0; i < PACK_SIZE; i++) {
					const rolled =
						tier.guaranteedMinRarity !== undefined &&
						i === GUARANTEED_SLOT_INDEX
							? rollGuaranteedCard(rng, tier, tier.guaranteedMinRarity)
							: rollCard(rng, tier);
					const { pull, refund } = await this.grantCard(
						current.id,
						rolled,
						cardsRepo,
					);
					current.coins += refund;
					pulls.push(pull);
				}

				await usersRepo.save(current);
				return { pulls, coins: current.coins };
			});
		} catch (err: unknown) {
			if (err instanceof HttpException) throw err;
			throw new InternalServerErrorException("Failed to open card pack");
		}
	}

	/**
	 * Grant one free card as a match-completion reward and return the pull.
	 * No coins are involved (the match itself awards coins). Always rolls
	 * against the basic tier's odds — match drops are earn-by-playing, not a
	 * paid pack, so there's no tier to select. Callers should treat this as
	 * best-effort — a cosmetic drop must never block recording a match result.
	 *
	 * @param rng injectable randomness; defaults to Math.random in production.
	 */
	async grantMatchDrop(user: User, rng: Rng = Math.random): Promise<PackPull> {
		try {
			const rolled = rollCard(rng, BASIC_PACK_TIER);
			const { pull } = await this.grantCard(
				user.id,
				rolled,
				this.userCardsRepo,
			);
			return pull;
		} catch (err: unknown) {
			if (err instanceof HttpException) throw err;
			throw new InternalServerErrorException("Failed to grant match card");
		}
	}

	/**
	 * Grant a single rolled card to a user: create the first copy, or increment
	 * an existing row (and compute the duplicate coin refund).
	 */
	private async grantCard(
		userId: number,
		rolled: RolledCard,
		repo: Repository<UserCard>,
	): Promise<{ pull: PackPull; refund: number }> {
		// rolled.cardId always comes from the catalogue via rollCard.
		const card = findCard(rolled.cardId);
		if (!card)
			throw new InternalServerErrorException("Rolled an unknown card");

		const existing = await repo.findOne({
			where: { user: { id: userId }, cardId: rolled.cardId },
			relations: ["user"],
		});

		if (existing) {
			return this.incrementExisting(existing, rolled, card, repo);
		}

		try {
			await repo.save(
				repo.create({
					user: { id: userId } as User,
					cardId: rolled.cardId,
					count: 1,
					foilCount: rolled.foil ? 1 : 0,
					prismaticCount: rolled.prismatic ? 1 : 0,
				}),
			);
			return {
				pull: {
					card,
					foil: rolled.foil,
					prismatic: rolled.prismatic,
					isNew: true,
				},
				refund: 0,
			};
		} catch (err: unknown) {
			// Two concurrent grants for this player's FIRST copy of the same
			// card (e.g. two match completions finishing at nearly the same
			// moment) can both miss the `existing` lookup above and then race
			// the unique index on (user, cardId). Previously this bubbled as
			// an unhandled 500 that `submitResult`'s best-effort wrapper
			// swallowed, silently losing the drop for the losing request
			// (Bug Audit L5). Re-read the row the winner just created and
			// fall through to the increment path instead.
			if ((err as { code?: string })?.code !== "23505") throw err;
			const raceWinner = await repo.findOne({
				where: { user: { id: userId }, cardId: rolled.cardId },
				relations: ["user"],
			});
			if (!raceWinner) throw err;
			return this.incrementExisting(raceWinner, rolled, card, repo);
		}
	}

	/** Increment an already-owned card row and compute the duplicate refund. */
	private async incrementExisting(
		existing: UserCard,
		rolled: RolledCard,
		card: CardDefinition,
		repo: Repository<UserCard>,
	): Promise<{ pull: PackPull; refund: number }> {
		existing.count += 1;
		if (rolled.foil) existing.foilCount += 1;
		if (rolled.prismatic) existing.prismaticCount += 1;
		await repo.save(existing);

		return {
			pull: {
				card,
				foil: rolled.foil,
				prismatic: rolled.prismatic,
				isNew: false,
			},
			refund: DUPLICATE_COIN_REFUND[card.rarity],
		};
	}

	/** Owned UserCard rows for a user, keyed by catalogue cardId. */
	private async findOwnedRows(
		userId: number,
		repo: Repository<UserCard> = this.userCardsRepo,
	): Promise<Map<string, UserCard>> {
		try {
			const rows = await repo.find({
				where: { user: { id: userId } },
				relations: ["user"],
			});
			return new Map(rows.map((row) => [row.cardId, row]));
		} catch {
			throw new InternalServerErrorException("Failed to load card binder");
		}
	}
}
