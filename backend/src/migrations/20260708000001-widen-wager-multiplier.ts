import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Widens wagers.multiplier from REAL (float4) to DOUBLE PRECISION (float8).
 *
 * Bug Audit 3.4: some games' multipliers aren't exact in binary at single
 * precision — e.g. Koi Dice's 100/99 ≈ 1.0101 — so the audited multiplier on
 * the immutable `wagers` row was silently rounded. `payout`/`net` are
 * already-computed integers, so money was never affected; this only degraded
 * the audit trail. `ALTER ... TYPE` with an explicit `USING` cast is a
 * metadata-only change for a numeric widening (no data rewrite, no
 * precision loss for existing rows — float4 values are always exactly
 * representable as float8).
 */
export class WidenWagerMultiplier20260708000001
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE wagers
      ALTER COLUMN multiplier TYPE DOUBLE PRECISION USING multiplier::DOUBLE PRECISION
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE wagers
      ALTER COLUMN multiplier TYPE REAL USING multiplier::REAL
    `);
	}
}
