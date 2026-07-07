import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PresenceModule } from "../presence/presence.module";
import { Notification } from "./entities/notification.entity";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
	imports: [TypeOrmModule.forFeature([Notification]), PresenceModule],
	providers: [NotificationsService],
	controllers: [NotificationsController],
	exports: [NotificationsService],
})
export class NotificationsModule {}
