import {
	Column,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/**
 * A player's ownership of a single Shell Card (catalog id `cardId`).
 *
 * One row per (user, card). `count` is the TOTAL copies owned; `foilCount` is
 * how many of those copies are the shiny foil variant (foilCount ≤ count).
 * Cards are purely cosmetic — this table never influences gameplay.
 */
@Entity("user_cards")
@Index(["user", "cardId"], { unique: true })
export class UserCard {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	@Column()
	cardId: string;

	/** Total copies owned (foil + non-foil). Always ≥ 1 once the row exists. */
	@Column({ type: "int", default: 1 })
	count: number;

	/** How many owned copies are the foil variant (0 ≤ foilCount ≤ count). */
	@Column({ type: "int", default: 0 })
	foilCount: number;

	/**
	 * How many owned copies are the rarer "prismatic" state — gold-rarity
	 * only, always a subset of the foil copies (0 ≤ prismaticCount ≤ foilCount).
	 */
	@Column({ type: "int", default: 0 })
	prismaticCount: number;

	@Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
	firstObtainedAt: Date;
}
