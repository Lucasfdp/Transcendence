import { ForbiddenException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { User } from "./entities/user.entity";

/**
 * Loads a user row under a `pessimistic_write` lock for safe read-modify-write
 * edits to mutable columns (`coins`, `xp`, `level`, ...) inside an existing
 * transaction.
 *
 * `loadEagerRelations: false` is REQUIRED: `User` eager-loads `Profile`, which
 * makes `findOne` emit a LEFT JOIN. Postgres rejects `FOR UPDATE` on the
 * nullable side of an outer join ("FOR UPDATE cannot be applied to the
 * nullable side of an outer join"), so the lock must target `users` alone —
 * fetch `Profile` (or any other relation) separately, after the lock, if the
 * caller needs it.
 *
 * Every service that reads-then-writes a mutable `users` column inside a
 * transaction MUST go through this helper instead of a bare `findOne` +
 * later `save()`. Under READ COMMITTED (Postgres's default), two concurrent
 * writers that both read the same pre-write balance and both save their own
 * read-modify-write result will silently lose one of the updates — coins get
 * minted or destroyed depending on write order. `CasinoEngine.resolveSpin`
 * already followed this discipline; `CardsService.openPack`,
 * `CustomizationService.buy`, `GameResultsService.submitResult` and
 * `AchievementsService`'s coin-reward path did not (Bug Audit 1.2) and raced
 * against it and each other on the same `users.coins` column.
 */
export async function lockUserForUpdate(
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
