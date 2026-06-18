import {
	Column,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

@Entity("user_achievements")
@Index(["user", "achievementId"], { unique: true })
export class UserAchievement {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	@Column()
	achievementId: string;

	@Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
	unlockedAt: Date;
}
