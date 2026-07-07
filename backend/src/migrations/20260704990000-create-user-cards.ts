import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the `user_cards` table (Bug Audit H2). This table has existed via
 * `synchronize: true` in dev since the original Shell Cards MVP, but prod runs
 * with `synchronize: false` and manual migrations (see app.module.ts) and no
 * migration ever created it — the only existing migration for this table,
 * 20260705000000-add-user-cards-prismatic.ts, only ALTERs a column and errors
 * out on a database where the table doesn't exist yet (`IF NOT EXISTS` guards
 * the column, not the table). This migration predates it (timestamp-ordered)
 * so the prismatic migration becomes safely additive on top of it.
 *
 * Column set and the unique index mirror `entities/user-card.entity.ts`
 * exactly. The unique index on ("userId", "cardId") is required for the
 * 23505-race handling in `CardsService.grantCard` to have any effect.
 */
export class CreateUserCards20260704990000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_cards (
        id                SERIAL PRIMARY KEY,
        "userId"          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "cardId"          VARCHAR      NOT NULL,
        count             INTEGER      NOT NULL DEFAULT 1,
        "foilCount"       INTEGER      NOT NULL DEFAULT 0,
        "firstObtainedAt" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

		await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_cards_userId_cardId"
        ON user_cards ("userId", "cardId")
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_user_cards_userId_cardId"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS user_cards`);
	}
}
