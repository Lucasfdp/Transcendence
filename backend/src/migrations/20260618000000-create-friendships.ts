import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the friendships table.
 *
 * Columns:
 *   requesterId  — the user who initiated the request (FK → users.id)
 *   addresseeId  — the user who received the request (FK → users.id)
 *   status       — 'pending' | 'accepted' | 'blocked'
 *
 * Constraints:
 *   - Unique on (requesterId, addresseeId) — no duplicate directed pairs
 *   - CHECK requesterId <> addresseeId — no self-friending
 *
 * Column names are quoted camelCase to match TypeORM's default naming used by
 * Friendship (requesterId, addresseeId, createdAt, updatedAt). The original
 * version of this migration created snake_case columns, which worked in dev
 * only because `synchronize` had already built the camelCase schema and the
 * `CREATE TABLE IF NOT EXISTS` then no-op'd — but broke on a production deploy
 * (synchronize off) where the migration is the sole schema author and every
 * friends query then failed with `column "requesterId" does not exist`
 * (Bug Audit H1). This migration is additive on top of the synchronize base:
 * on an existing dev DB the IF NOT EXISTS guards make it a no-op either way.
 */
export class CreateFriendships20260618000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id            SERIAL PRIMARY KEY,
        "requesterId" INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "addresseeId" INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
        "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_friendship           UNIQUE ("requesterId", "addresseeId"),
        CONSTRAINT chk_no_self_friendship  CHECK  ("requesterId" <> "addresseeId")
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_friendships_requester
      ON friendships ("requesterId")
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_friendships_addressee
      ON friendships ("addresseeId")
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS friendships`);
	}
}
