import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the user_ratings table (Rankings Bug Audit H1).
 *
 * `user_ratings` backs the per-game ELO leaderboard (`GET /leaderboard`) and
 * has existed only via `synchronize: true` since it was introduced — no
 * migration ever created it. `synchronize` is disabled in production
 * (`app.module.ts`, `NODE_ENV !== "production"`), so a production database
 * built solely from migrations has no `user_ratings` table: every ranked
 * match finish (which writes ratings in
 * `GameSessionService.applyEloRatings`) and every call to `GET /leaderboard`
 * throws, surfaced to players as a permanent "No rankings yet." empty state.
 *
 * Column names are quoted camelCase to match TypeORM's default naming used
 * by the `UserRating` entity (userId, gameId, updatedAt), following the same
 * pattern — and avoiding the same past mistake — documented in
 * `20260618000000-create-friendships.ts`. On an existing dev DB (already
 * built via synchronize), the `IF NOT EXISTS` guards make table creation a
 * no-op.
 *
 * Also adds a unique index on ("userId","gameId"), which the entity was
 * also missing. `applyEloRatings` does a find-or-create with no row lock, so
 * a double-persist race (Rankings Bug Audit M4) could otherwise insert
 * duplicate rating rows for the same player+game — the frontend renders
 * leaderboard rows keyed by `entry.userId`, so a duplicate is a duplicate
 * React key, not just a display glitch. Any duplicates already present on a
 * synchronize-built dev DB are de-duped first — the row with the most games
 * played (wins+losses+draws) is kept as the more "complete" record — so the
 * index creation below cannot fail on pre-existing data.
 */
export class CreateUserRatings20260715000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_ratings (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId"    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "gameId"    VARCHAR      NOT NULL,
        rating      INTEGER      NOT NULL DEFAULT 1000,
        wins        INTEGER      NOT NULL DEFAULT 0,
        losses      INTEGER      NOT NULL DEFAULT 0,
        draws       INTEGER      NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

		await queryRunner.query(`
      DELETE FROM user_ratings a
      USING user_ratings b
      WHERE a.id <> b.id
        AND a."userId" = b."userId"
        AND a."gameId" = b."gameId"
        AND (
          (a.wins + a.losses + a.draws) < (b.wins + b.losses + b.draws)
          OR (
            (a.wins + a.losses + a.draws) = (b.wins + b.losses + b.draws)
            AND a.id < b.id
          )
        )
    `);

		await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ratings_user_game
      ON user_ratings ("userId", "gameId")
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_ratings_game_rating
      ON user_ratings ("gameId", rating DESC)
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS idx_user_ratings_game_rating`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS uq_user_ratings_user_game`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS user_ratings`);
	}
}
