import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds user_game_stats."perfectRounds" — how many PERFECT rounds the user has
 * achieved in a game (Kame Knock: every breakable target cleared within one
 * ball round). A participation metric in the same trust class as
 * `gamesPlayed`: reported by local play, feeds the Kame Perfect achievement
 * ladder, and never touches the leaderboard's win counters.
 *
 * `NOT NULL DEFAULT 0` backfills existing rows to zero perfects, which is the
 * correct historical value: the counter did not exist before.
 */
export class AddUserGameStatsPerfectRounds20260720000000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE user_game_stats
      ADD COLUMN IF NOT EXISTS "perfectRounds" INTEGER NOT NULL DEFAULT 0
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE user_game_stats
      DROP COLUMN IF EXISTS "perfectRounds"
    `);
	}
}
