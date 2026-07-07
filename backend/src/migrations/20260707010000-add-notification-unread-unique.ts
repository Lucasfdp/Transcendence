import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds a partial unique index enforcing at most one *unread* notification per
 * (type, fromUserId, toUserId) triple (Bug Audit L7).
 *
 * NotificationsService.create() already does a check-then-insert dedup, but
 * that is racy: two concurrent friend_request pushes can both pass the lookup
 * and insert two unread rows, which later act independently (one accepted, one
 * declined → net added-then-removed). This index makes the DB the source of
 * truth; the losing insert fails with 23505, which create() now swallows as a
 * successful no-op.
 *
 * PARTIAL on `readAt IS NULL` so historical (read) notifications of the same
 * triple are unconstrained — only the live/unread one must be unique.
 */
export class AddNotificationUnreadUnique20260707010000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_unread_triple
      ON notifications (type, "fromUserId", "toUserId")
      WHERE "readAt" IS NULL
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS uq_notification_unread_triple`,
		);
	}
}
