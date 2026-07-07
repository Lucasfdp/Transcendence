import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the notifications table for persistent social notifications.
 *
 * Only "durable" notification types are stored here (friend_request,
 * friend_accepted). Ephemeral game-invite notifications are delivered
 * live-only via WebSocket and are never persisted.
 *
 * Columns:
 *   type       — notification type ('friend_request' | 'friend_accepted')
 *   fromUserId — the user who triggered the notification (FK → users.id)
 *   toUserId   — the recipient (FK → users.id)
 *   payload    — optional JSONB metadata (e.g. sender username)
 *   readAt     — NULL = unread; timestamp when the recipient dismissed it
 *   createdAt  — insertion timestamp
 *
 * Column names are quoted camelCase to match TypeORM's default naming used by
 * Notification (fromUserId, toUserId, readAt, createdAt). See the H1 note on
 * the friendships migration: the original snake_case version only appeared to
 * work in dev because `synchronize` had already built the camelCase schema,
 * and broke every notifications query on a production deploy (Bug Audit H1).
 */
export class CreateNotifications20260627000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id           SERIAL       PRIMARY KEY,
        type         VARCHAR(32)  NOT NULL,
        "fromUserId" INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "toUserId"   INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload      JSONB        DEFAULT NULL,
        "readAt"     TIMESTAMPTZ  DEFAULT NULL,
        "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_to_user_unread
      ON notifications ("toUserId", "readAt")
      WHERE "readAt" IS NULL
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
	}
}
