import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the shell_inventory table and back-fills 999 of every shell type
 * for all existing users.
 *
 * The table is (user_id, shell_type) unique — quantity is updated in place.
 * The 'none' shell type is intentionally excluded from the backfill because
 * it is always free and never stored.
 */
export class CreateShellInventory20260614062701 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		// ── Create table ──────────────────────────────────────────────────────────
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS shell_inventory (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shell_type  VARCHAR(32)  NOT NULL,
        quantity    INTEGER      NOT NULL DEFAULT 999,
        UNIQUE (user_id, shell_type)
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_shell_inventory_user
      ON shell_inventory (user_id)
    `);

		// ── Backfill existing users with 999 of every shell ───────────────────────
		await queryRunner.query(`
      INSERT INTO shell_inventory (user_id, shell_type, quantity)
      SELECT u.id, s.shell_type, 999
      FROM users u
      CROSS JOIN (VALUES
        ('heavy'), ('bomb'), ('splitter'), ('ghost'), ('magnet'),
        ('spinning'), ('bouncer'), ('shield'), ('freeze'), ('slick'),
        ('rocket'), ('giant'), ('tiny'), ('boomerang'), ('repel'),
        ('sticky'), ('lightning'), ('vortex'), ('clone'), ('ricochet'), ('phantom')
      ) AS s(shell_type)
      WHERE NOT EXISTS (
        SELECT 1 FROM shell_inventory si
        WHERE si.user_id = u.id
          AND si.shell_type = s.shell_type
      )
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS shell_inventory`);
	}
}
