import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds a partial unique index guaranteeing at most one *active* friendship row
 * per unordered pair of users (Bug Audit M2).
 *
 * The base table only has a per-direction unique index on
 * (requesterId, addresseeId), so two concurrent opposite-direction requests
 * (A→B and B→A) could both pass the service's check-then-insert and create two
 * pending rows. This index closes that race at the DB level by keying on the
 * order-independent pair (LEAST, GREATEST).
 *
 * It is deliberately PARTIAL — scoped to status IN ('pending','accepted') — so
 * it does NOT constrain 'blocked' rows: mutual blocks (A→B and B→A both
 * 'blocked') must remain representable (Bug Audit M1). A losing concurrent
 * insert now fails with 23505, which FriendsService.sendRequest already maps to
 * a 409 (or, for a reverse pending row, resolves as an auto-accept before any
 * insert is attempted).
 */
export class AddFriendshipPairUnique20260707000000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_active_pair
      ON friendships (
        LEAST("requesterId", "addresseeId"),
        GREATEST("requesterId", "addresseeId")
      )
      WHERE status IN ('pending', 'accepted')
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS uq_friendship_active_pair`,
		);
	}
}
