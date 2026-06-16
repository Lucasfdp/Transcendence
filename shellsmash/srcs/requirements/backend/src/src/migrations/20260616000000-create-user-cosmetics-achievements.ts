import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserCosmeticsAchievements20260616000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_cosmetics (
        id             SERIAL PRIMARY KEY,
        "userId"       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "cosmeticId"   VARCHAR     NOT NULL,
        "unlockedAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cosmetics_user_cosmetic
      ON user_cosmetics ("userId", "cosmeticId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user_id
      ON user_cosmetics ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_cosmetics_cosmetic_id
      ON user_cosmetics ("cosmeticId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id              SERIAL PRIMARY KEY,
        "userId"        INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "achievementId" VARCHAR     NOT NULL,
        "unlockedAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_user_achievement
      ON user_achievements ("userId", "achievementId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id
      ON user_achievements ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id
      ON user_achievements ("achievementId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_achievements`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_cosmetics`);
  }
}
