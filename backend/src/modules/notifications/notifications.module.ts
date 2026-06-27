import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PresenceModule } from "../presence/presence.module";
import { Notification } from "./entities/notification.entity";
import { NotificationsService } from "./notifications.service";

@Module({
	imports: [TypeOrmModule.forFeature([Notification]), PresenceModule],
	providers: [NotificationsService],
	exports: [NotificationsService],
})
export class NotificationsModule {}
