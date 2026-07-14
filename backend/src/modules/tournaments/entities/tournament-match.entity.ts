import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Match } from "../../matchmaking/entities/match.entity";
import { Tournament } from "./tournament.entity";

export type TournamentMatchPurpose = "round_minigame" | "final_challenge";

/**
 * Bridge table linking a Tournament to the `matches` rows of its minigames
 * (SPEC-037). Minigame matches are regular `mode: casual` matches — no third
 * MatchMode exists; this table alone identifies tournament matches.
 */
@Entity("tournament_matches")
export class TournamentMatch {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => Tournament, (tournament) => tournament.matches, {
		onDelete: "CASCADE",
	})
	tournament: Tournament;

	@Column()
	tournamentId: string;

	@ManyToOne(() => Match, { onDelete: "CASCADE" })
	match: Match;

	@Column()
	matchId: string;

	/** Tournament round this minigame belongs to. */
	@Column()
	round: number;

	@Column()
	purpose: TournamentMatchPurpose;
}
