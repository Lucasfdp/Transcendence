import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from "class-validator";

export class PublicApiQueryUsersDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(25)
	@IsString({ each: true })
	usernames: string[];
}
