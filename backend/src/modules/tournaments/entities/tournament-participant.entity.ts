import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Tournament } from "./tournament.entity";

/**
 * One player's seat in a Tournament (SPEC-037).
 *
 * The user FK is SET NULL (same pattern as `match_players`) so deleting an
 * account never destroys the tournament's historical record.
 */
@Entity("tournament_participants")
export class TournamentParticipant {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => Tournament, (tournament) => tournament.participants, {
		onDelete: "CASCADE",
	})
	tournament: Tournament;

	@Column()
	tournamentId: string;

	@ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
	user: User | null;

	@Column({ nullable: true })
	userId: number | null;

	/** Seat / turn order within the tournament. */
	@Column()
	seat: number;

	/** Final points once the tournament concludes; live points live in the snapshot. */
	@Column({ type: "int", default: 0 })
	finalPoints: number;

	/**
	 * True once the player quit the match for good ("Leave match"): they are
	 * removed from the tournament, can never rejoin it, and — unlike a mere
	 * disconnect — no longer count as "in a tournament", so they may create or
	 * join a new one right away. A disconnect never sets this (it stays
	 * reconnectable).
	 */
	@Column({ type: "boolean", default: false })
	hasLeft: boolean;

	@Column({ nullable: true })
	outcome: string | null;
}
