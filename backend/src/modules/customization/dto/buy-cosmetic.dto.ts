import { IsString } from "class-validator";

export class BuyCosmeticDto {
	@IsString()
	cosmeticId: string;
}
