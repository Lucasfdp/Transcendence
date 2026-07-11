import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMonteRounds20260711010000 implements MigrationInterface {
	name = "CreateMonteRounds20260711010000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "casino_monte_rounds" (
				"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
				"stake" integer NOT NULL,
				"cupIds" jsonb NOT NULL,
				"ballCupId" varchar NOT NULL,
				"serverSeedHash" varchar NOT NULL,
				"serverSeed" varchar NOT NULL,
				"clientSeed" varchar NOT NULL DEFAULT '',
				"nonce" integer NOT NULL,
				"winningCupHash" varchar NOT NULL,
				"status" varchar NOT NULL DEFAULT 'pending',
				"selectedCupId" varchar NULL DEFAULT NULL,
				"payout" integer NULL DEFAULT NULL,
				"net" integer NULL DEFAULT NULL,
				"expiresAt" timestamptz NOT NULL,
				"createdAt" timestamptz NOT NULL DEFAULT now(),
				"updatedAt" timestamptz NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_casino_monte_rounds_user_status"
			ON "casino_monte_rounds" ("userId", "status")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_casino_monte_rounds_user_status"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "casino_monte_rounds"`);
	}
}
