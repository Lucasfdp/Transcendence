import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMatchReplays20260630190000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS match_replays (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				"matchId" UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
				"gameId" VARCHAR NOT NULL,
				mode VARCHAR NOT NULL,
				frames JSONB NOT NULL DEFAULT '[]',
				"frameCount" INTEGER NOT NULL DEFAULT 0,
				"expiresAt" TIMESTAMPTZ NULL,
				"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS match_replay_saves (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				"replayId" UUID NOT NULL REFERENCES match_replays(id) ON DELETE CASCADE,
				"userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT "UQ_match_replay_saves_replay_user" UNIQUE ("replayId", "userId")
			)
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_match_replays_expiresAt"
			ON match_replays ("expiresAt")
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_match_replay_saves_userId"
			ON match_replay_saves ("userId")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_match_replay_saves_userId"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_match_replays_expiresAt"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS match_replay_saves`);
		await queryRunner.query(`DROP TABLE IF EXISTS match_replays`);
	}
}
