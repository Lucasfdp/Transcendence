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
 * Note: there is currently no migration at all for the original `user_cards`
 * table (not even for `count`/`foilCount`, a pre-existing gap from the
 * original MVP) — this migration only adds the new column and doesn't
 * attempt to backfill that gap.
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
