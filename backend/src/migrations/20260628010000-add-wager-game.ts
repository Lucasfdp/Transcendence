import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add the `game` discriminator to the shared `wagers` audit table so a single
 * table can back every gambling-den game (wheel, flip, monte, slots). Existing
 * rows predate the column, so it defaults to 'wheel'. In the dev container
 * `synchronize` creates the column automatically; this migration is for prod.
 */
export class AddWagerGame20260628010000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE wagers ADD COLUMN IF NOT EXISTS game VARCHAR NOT NULL DEFAULT 'wheel'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE wagers DROP COLUMN IF EXISTS game`,
		);
	}
}
