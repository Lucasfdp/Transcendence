import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds turtle personality tag and achievement showcase to the profiles table.
 *
 * Columns:
 *   tag                   — single turtle-tag ID chosen by the player (nullable)
 *   showcasedAchievements — JSON array of up to 3 pinned achievement IDs (nullable)
 *
 * The old `bio` column is dropped: it has been superseded by the tag and
 * achievement showcase. Data loss is intentional — bio was never prominently
 * surfaced and no users have meaningful content there yet.
 */
export class AddProfileTagShowcasedAchievements20260627100000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS tag VARCHAR DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "showcasedAchievements" JSON DEFAULT NULL
    `);

		await queryRunner.query(`
      ALTER TABLE profiles
        DROP COLUMN IF EXISTS bio
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS bio VARCHAR DEFAULT NULL
    `);

		await queryRunner.query(`
      ALTER TABLE profiles
        DROP COLUMN IF EXISTS tag,
        DROP COLUMN IF EXISTS "showcasedAchievements"
    `);
	}
}
