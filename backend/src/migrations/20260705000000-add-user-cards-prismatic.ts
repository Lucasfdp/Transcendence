import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add `prismaticCount` to `user_cards` for the "Prismatic" super-foil tier
 * (gold-rarity cards only, layered on top of the existing foil flag — see
 * docs/SHELL_CARDS_SPEC.md's Prismatic section and
 * docs/handoff-shell-cards-prismatic-and-characters.md). In the dev
 * container `synchronize` creates the column automatically; this migration
 * is for prod, matching the `IF NOT EXISTS` pattern used by
 * 20260628010000-add-wager-game.ts.
 *
 * Note: 20260704990000-create-user-cards.ts (Bug Audit H2) now creates the
 * base table with `count`/`foilCount`, closing the gap that used to exist
 * here — this migration only adds the new column on top of it.
 */
export class AddUserCardsPrismatic20260705000000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS "prismaticCount" INT NOT NULL DEFAULT 0`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE user_cards DROP COLUMN IF EXISTS "prismaticCount"`,
		);
	}
}
