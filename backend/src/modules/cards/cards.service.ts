import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
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
	private readonly logger = new Logger(CardsService.name);

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
				const current = await this.lockUser(manager, user.id);
				if (current.coins < tier.priceCoins)
					throw new BadRequestException("Not enough coins");

				const cardsRepo = manager.getRepository(UserCard);

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

				await manager.getRepository(User).save(current);
				return { pulls, coins: current.coins };
			});
		} catch (err: unknown) {
			if (err instanceof HttpException) throw err;
			this.logger.error(
				`openPack failed for user ${user.id} (tier ${tierId})`,
				err instanceof Error ? err.stack : err,
			);
			throw new InternalServerErrorException("Failed to open card pack");
		}
	}

	/**
	 * Load the player's row under a pessimistic write-lock for safe balance
	 * edits (Bug Audit H1). Without this, two concurrent `openPack` calls can
	 * both read the same `coins` balance, both pass the affordability check,
	 * and the last `save` wins — double-granting packs while charging once.
	 * Mirrors `casino.engine.ts`'s `lockUser`: `loadEagerRelations: false` is
	 * REQUIRED because `User` eager-loads `Profile`, which makes `findOne`
	 * emit a LEFT JOIN, and Postgres rejects `FOR UPDATE` on the nullable side
	 * of an outer join.
	 */
	private async lockUser(
		manager: EntityManager,
		userId: number,
	): Promise<User> {
		const current = await manager.getRepository(User).findOne({
			where: { id: userId },
			lock: { mode: "pessimistic_write" },
			loadEagerRelations: false,
		});
		if (!current) throw new ForbiddenException("User not found");
		return current;
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
			this.logger.error(
				`grantMatchDrop failed for user ${user.id}`,
				err instanceof Error ? err.stack : err,
			);
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

		// Only the FK is needed here, not a hydrated `user` relation — querying
		// by `{ user: { id } }` filters on the FK column without the extra join
		// (Bug Audit L4).
		const existing = await repo.findOne({
			where: { user: { id: userId }, cardId: rolled.cardId },
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
			});
			if (!raceWinner) throw err;
			return this.incrementExisting(raceWinner, rolled, card, repo);
		}
	}

	/**
	 * Increment an already-owned card row and compute the duplicate refund.
	 *
	 * Bug Audit M2: this used to be a read-modify-write (`existing.count += 1`
	 * then `repo.save(existing)`), which loses updates under concurrency — two
	 * near-simultaneous grants of the same card (e.g. a match-drop racing a
	 * pack open, since `grantMatchDrop` runs outside `openPack`'s transaction)
	 * can both read the same in-memory count and both write back N+1. Atomic
	 * SQL increments avoid the lost-update window entirely; each is its own
	 * `UPDATE ... SET col = col + 1` statement, so no read-then-write race is
	 * possible even without a shared lock.
	 */
	private async incrementExisting(
		existing: UserCard,
		rolled: RolledCard,
		card: CardDefinition,
		repo: Repository<UserCard>,
	): Promise<{ pull: PackPull; refund: number }> {
		await repo.increment({ id: existing.id }, "count", 1);
		if (rolled.foil) {
			await repo.increment({ id: existing.id }, "foilCount", 1);
		}
		if (rolled.prismatic) {
			await repo.increment({ id: existing.id }, "prismaticCount", 1);
		}

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
			// Only the FK is needed to key the map by cardId — no need to
			// hydrate the `user` relation on every binder read (Bug Audit L4).
			const rows = await repo.find({
				where: { user: { id: userId } },
			});
			return new Map(rows.map((row) => [row.cardId, row]));
		} catch (err: unknown) {
			this.logger.error(
				`findOwnedRows failed for user ${userId}`,
				err instanceof Error ? err.stack : err,
			);
			throw new InternalServerErrorException("Failed to load card binder");
		}
	}
}
