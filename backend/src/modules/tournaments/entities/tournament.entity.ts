import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { TournamentMatch } from "./tournament-match.entity";
import { TournamentParticipant } from "./tournament-participant.entity";

export type TournamentStatus = "pending" | "active" | "finished" | "cancelled";

/**
 * A Tournament session (The Parrot's Shell board-game mode, SPEC-037).
 *
 * The tournament is a long-lived session: `state` holds the serialized
 * Runtime snapshot (updated after every state-machine transition) so the
 * whole session is reconstructible from Postgres. Memory is only a cache.
 */
@Entity("tournaments")
export class Tournament {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ default: "pending" })
	status: TournamentStatus;

	/** Id of the declarative configuration catalog used by this session. */
	@Column()
	configId: string;

	/** Serialized Runtime snapshot; null until the Runtime is initialized. */
	@Column({ type: "jsonb", nullable: true })
	state: Record<string, unknown> | null;

	@ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
	winnerUser: User | null;

	@Column({ nullable: true })
	winnerUserId: number | null;

	@CreateDateColumn()
	createdAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	startedAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	finishedAt: Date | null;

	@OneToMany(
		() => TournamentParticipant,
		(participant) => participant.tournament,
	)
	participants: TournamentParticipant[];

	@OneToMany(() => TournamentMatch, (match) => match.tournament)
	matches: TournamentMatch[];
}
