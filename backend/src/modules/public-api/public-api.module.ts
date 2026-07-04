import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { PublicApiController } from "./public-api.controller";
import { PublicApiGuard } from "./public-api.guard";
import { PublicApiService } from "./public-api.service";

@Module({
	imports: [AuthModule, UsersModule],
	controllers: [PublicApiController],
	providers: [PublicApiService, PublicApiGuard],
})
export class PublicApiModule {}
