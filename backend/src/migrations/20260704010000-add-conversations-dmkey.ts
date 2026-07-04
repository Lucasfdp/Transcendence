import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds a canonical `dmKey` to `conversations` and a unique index on it.
 *
 * Bug Audit M3: `ChatService.getOrCreateDirectConversation()` did a
 * find-existing-then-create with no DB constraint enforcing "one DM per user
 * pair". Two near-simultaneous `POST /chat/conversations/direct` calls (e.g.
 * a double-click, or both users opening the DM at once) could both miss the
 * existing conversation and each create a new one, splitting messages across
 * two threads.
 *
 * `dmKey` is `min(userAId, userBId) + ":" + max(userAId, userBId)`, computed
 * in application code (see ChatService.dmKeyFor). It is always NULL for
 * "group" conversations — Postgres unique indexes treat NULL as distinct
 * from every other value (including other NULLs), so group rows never
 * collide against this constraint.
 */
export class AddConversationsDmKey20260704010000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS "dmKey" VARCHAR(64) DEFAULT NULL
    `);

		// Backfill dmKey for any dm conversations created before this migration,
		// so the unique index below can't be defeated by pre-existing duplicates
		// silently bypassing the app-level dedupe going forward.
		await queryRunner.query(`
      UPDATE conversations c
      SET "dmKey" = sub.key
      FROM (
        SELECT
          cp."conversationId" AS "conversationId",
          LEAST(MIN(cp."userId"), MAX(cp."userId")) || ':' ||
            GREATEST(MIN(cp."userId"), MAX(cp."userId")) AS key
        FROM conversation_participants cp
        GROUP BY cp."conversationId"
        HAVING COUNT(*) = 2
      ) sub
      WHERE c.id = sub."conversationId"
        AND c.type = 'dm'
        AND c."dmKey" IS NULL
    `);

		await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_conversations_dmKey"
        ON conversations ("dmKey")
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "UQ_conversations_dmKey"`,
		);
		await queryRunner.query(
			`ALTER TABLE conversations DROP COLUMN IF EXISTS "dmKey"`,
		);
	}
}
