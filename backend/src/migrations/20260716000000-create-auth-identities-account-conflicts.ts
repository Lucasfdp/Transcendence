import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthIdentitiesAccountConflicts20260716000000
	implements MigrationInterface
{
	name = "CreateAuthIdentitiesAccountConflicts20260716000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mergedIntoUserId" integer`,
		);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "auth_identities" (
				"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
				"userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
				"method" varchar(16) NOT NULL,
				"providerSubject" varchar NULL,
				"shellUsername" varchar(20) NULL,
				"shellEmail" varchar(254) NULL,
				"passwordHash" text NULL,
				"createdAt" timestamptz NOT NULL DEFAULT now(),
				"updatedAt" timestamptz NOT NULL DEFAULT now(),
				CONSTRAINT "chk_auth_identity_method" CHECK ("method" IN ('shellsmash', 'google', 'forty_two'))
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identity_user_method" ON "auth_identities" ("userId", "method")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identity_provider_subject" ON "auth_identities" ("method", "providerSubject") WHERE "providerSubject" IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identity_shell_username" ON "auth_identities" ("shellUsername") WHERE "shellUsername" IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identity_shell_email" ON "auth_identities" (LOWER("shellEmail")) WHERE "shellEmail" IS NOT NULL`,
		);
		await queryRunner.query(`
			INSERT INTO "auth_identities" ("userId", "method", "shellUsername", "shellEmail", "passwordHash")
			SELECT id, 'shellsmash', username, LOWER(email), "passwordHash"
			FROM users WHERE "passwordHash" IS NOT NULL
			ON CONFLICT DO NOTHING
		`);
		await queryRunner.query(`
			INSERT INTO "auth_identities" ("userId", "method", "providerSubject")
			SELECT id, 'google', "googleId" FROM users WHERE "googleId" IS NOT NULL
			ON CONFLICT DO NOTHING
		`);
		await queryRunner.query(`
			INSERT INTO "auth_identities" ("userId", "method", "providerSubject")
			SELECT id, 'forty_two', "fortyTwoId" FROM users WHERE "fortyTwoId" IS NOT NULL
			ON CONFLICT DO NOTHING
		`);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "account_link_conflicts" (
				"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
				"initiatorUserId" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
				"linkedUserId" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
				"sourceMethod" varchar(16) NOT NULL,
				"status" varchar(16) NOT NULL DEFAULT 'pending',
				"resolution" varchar(16) NULL,
				"finalUserId" integer NULL,
				"createdAt" timestamptz NOT NULL DEFAULT now(),
				"updatedAt" timestamptz NOT NULL DEFAULT now(),
				CONSTRAINT "chk_account_link_distinct_users" CHECK ("initiatorUserId" <> "linkedUserId")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_account_link_pending_initiator" ON "account_link_conflicts" ("initiatorUserId") WHERE "status" = 'pending'`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "idx_account_link_pending_linked" ON "account_link_conflicts" ("linkedUserId") WHERE "status" = 'pending'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "account_link_conflicts"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "auth_identities"`);
		await queryRunner.query(
			`ALTER TABLE "users" DROP COLUMN IF EXISTS "mergedIntoUserId"`,
		);
	}
}
