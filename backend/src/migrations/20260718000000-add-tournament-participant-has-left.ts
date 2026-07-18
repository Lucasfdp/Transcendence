import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds tournament_participants."hasLeft" — true once a player quits the match
 * for good via the "Leave match" button (tournament:quit).
 *
 * A quitter is removed from the tournament and can never rejoin it, and is no
 * longer counted as "in a tournament" by the one-tournament-per-user gate
 * (tournament-lobby.service.ts assertNotInAnotherTournament / getMyLobby), so
 * they may create or join a new tournament immediately. A plain disconnect
 * never sets this — it stays reconnectable.
 *
 * `NOT NULL DEFAULT false` backfills existing rows to "not left", which is the
 * correct historical value: no prior player had this permanent-leave semantic.
 */
export class AddTournamentParticipantHasLeft20260718000000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE tournament_participants
      ADD COLUMN IF NOT EXISTS "hasLeft" BOOLEAN NOT NULL DEFAULT false
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE tournament_participants
      DROP COLUMN IF EXISTS "hasLeft"
    `);
	}
}
