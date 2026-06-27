import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { UsersModule } from "../users/users.module";
import { CardsController } from "./cards.controller";
import { CardsService } from "./cards.service";
import { UserCard } from "./entities/user-card.entity";

/**
 * Shell Cards — collectible card binder (cosmetic only).
 *
 * See docs/SHELL_CARDS_SPEC.md.
 */
@Module({
	imports: [TypeOrmModule.forFeature([UserCard, User]), UsersModule],
	controllers: [CardsController],
	providers: [CardsService],
	exports: [CardsService],
})
export class CardsModule {}
