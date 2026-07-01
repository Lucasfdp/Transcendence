import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds users."lastSeenAt" — the timestamp of a user's most recent socket
 * disconnect, used to render "last online" for offline friends.
 *
 * Nullable with no default: existing rows stay NULL until the user next goes
 * offline. Column name is camelCase to match the rest of the users table
 * (TypeORM default naming on this entity).
 */
export class AddUserLastSeen20260701000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMPTZ NULL
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "lastSeenAt"
    `);
	}
}
