import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ShellInventoryItem } from "./entities/shell-inventory-item.entity";
import { ShellsService } from "./shells.service";
import { ShellsController } from "./shells.controller";
import { UsersModule } from "../users/users.module";

@Module({
	imports: [
		TypeOrmModule.forFeature([ShellInventoryItem]),
		forwardRef(() => UsersModule),
	],
	providers: [ShellsService],
	controllers: [ShellsController],
	exports: [ShellsService],
})
export class ShellsModule {}
