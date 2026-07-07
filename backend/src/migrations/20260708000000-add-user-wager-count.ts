import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds users."wagerCount" — a lifetime counter of casino wagers placed,
 * incremented under the same pessimistic-write lock as the spin's coin delta
 * and used as the provably-fair nonce for the *next* spin.
 *
 * Bug Audit 3.3: the nonce was previously derived from
 * `wagersRepo.count({ user })` on every spin — correct, but an unbounded
 * `COUNT(*)` scan over the user's entire wager history that grows forever.
 * An O(1) counter column serialized under the same row lock is functionally
 * identical (still strictly increasing, still read-then-written atomically)
 * without the scan.
 *
 * `NOT NULL DEFAULT 0` backfills existing rows to 0 — safe, since the nonce
 * only needs to keep increasing from whatever value it starts at; it never
 * needs to match a specific historical count.
 */
export class AddUserWagerCount20260708000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "wagerCount" INTEGER NOT NULL DEFAULT 0
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "wagerCount"
    `);
	}
}
