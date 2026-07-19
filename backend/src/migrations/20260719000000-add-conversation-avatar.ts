import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds conversations."avatar" — the group photo URL (an /api/uploads/ path
 * written by the owner-only POST /chat/conversations/:id/avatar endpoint).
 * Always null for "dm" conversations, whose list avatar is the other
 * participant's own avatar resolved per-viewer. Nullable with no default:
 * existing groups simply have no photo yet and render the default group
 * image on the client.
 */
export class AddConversationAvatar20260719000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS "avatar" TEXT DEFAULT NULL
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE conversations
      DROP COLUMN IF EXISTS "avatar"
    `);
	}
}
