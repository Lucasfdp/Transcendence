import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the notifications table for persistent social notifications.
 *
 * Only "durable" notification types are stored here (friend_request,
 * friend_accepted). Ephemeral game-invite notifications are delivered
 * live-only via WebSocket and are never persisted.
 *
 * Columns:
 *   type         — notification type ('friend_request' | 'friend_accepted')
 *   from_user_id — the user who triggered the notification (FK → users.id)
 *   to_user_id   — the recipient (FK → users.id)
 *   payload      — optional JSONB metadata (e.g. sender username)
 *   read_at      — NULL = unread; timestamp when the recipient dismissed it
 *   created_at   — insertion timestamp
 */
export class CreateNotifications20260627000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id            SERIAL       PRIMARY KEY,
        type          VARCHAR(32)  NOT NULL,
        from_user_id  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload       JSONB        DEFAULT NULL,
        read_at       TIMESTAMPTZ  DEFAULT NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_to_user_unread
      ON notifications (to_user_id, read_at)
      WHERE read_at IS NULL
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
	}
}
