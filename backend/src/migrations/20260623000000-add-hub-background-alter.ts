import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHubBackgroundAlter20260623000000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "hubBackgroundAlter" VARCHAR DEFAULT NULL
    `);

		await queryRunner.query(`
      UPDATE users
      SET "hubBackground" = 'night_bg',
          "hubBackgroundAlter" = 'night_cycle_bg'
      WHERE "hubBackground" = 'cycle_bg'
    `);

		await queryRunner.query(`
      INSERT INTO user_cosmetics ("userId", "cosmeticId")
      SELECT id, 'night_cycle_bg'
      FROM users
      WHERE "hubBackgroundAlter" = 'night_cycle_bg'
      ON CONFLICT ("userId", "cosmeticId") DO NOTHING
    `);

		await queryRunner.query(`
      UPDATE user_cosmetics
      SET "cosmeticId" = 'night_cycle_bg'
      WHERE "cosmeticId" = 'cycle_bg'
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      UPDATE users
      SET "hubBackground" = 'cycle_bg',
          "hubBackgroundAlter" = NULL
      WHERE "hubBackground" = 'night_bg'
        AND "hubBackgroundAlter" = 'night_cycle_bg'
    `);

		await queryRunner.query(`
      UPDATE user_cosmetics
      SET "cosmeticId" = 'cycle_bg'
      WHERE "cosmeticId" = 'night_cycle_bg'
    `);

		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "hubBackgroundAlter"
    `);
	}
}
