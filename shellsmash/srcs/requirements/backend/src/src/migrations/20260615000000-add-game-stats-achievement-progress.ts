import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameStatsAchievementProgress20260615000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS "totalCoinsEarned" INTEGER NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_game_stats (
        id            SERIAL PRIMARY KEY,
        "userId"      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "gameId"      VARCHAR      NOT NULL,
        "gamesPlayed" INTEGER      NOT NULL DEFAULT 0,
        "totalWins"   INTEGER      NOT NULL DEFAULT 0,
        "totalLosses" INTEGER      NOT NULL DEFAULT 0,
        UNIQUE ("userId", "gameId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_game_stats`);
    await queryRunner.query(`ALTER TABLE profiles DROP COLUMN IF EXISTS "totalCoinsEarned"`);
  }
}
