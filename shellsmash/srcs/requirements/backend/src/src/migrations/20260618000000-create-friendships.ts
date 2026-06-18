import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the friendships table.
 *
 * Columns:
 *   requester_id  — the user who initiated the request (FK → users.id)
 *   addressee_id  — the user who received the request (FK → users.id)
 *   status        — 'pending' | 'accepted' | 'blocked'
 *
 * Constraints:
 *   - Unique on (requester_id, addressee_id) — no duplicate directed pairs
 *   - CHECK requester_id <> addressee_id — no self-friending
 */
export class CreateFriendships20260618000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id            SERIAL PRIMARY KEY,
        requester_id  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_friendship           UNIQUE (requester_id, addressee_id),
        CONSTRAINT chk_no_self_friendship  CHECK  (requester_id <> addressee_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_friendships_requester
      ON friendships (requester_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_friendships_addressee
      ON friendships (addressee_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS friendships`);
  }
}
