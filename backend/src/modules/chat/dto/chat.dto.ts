import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	IsInt,
	IsPositive,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";
import { MESSAGE_BODY_MAX_LENGTH } from "../entities/message.entity";

/** Cap group size so a single conversation can't be turned into a mass broadcast list. */
const GROUP_MAX_MEMBERS = 50;
const GROUP_NAME_MAX_LENGTH = 60;

export class StartDirectMessageDto {
	@IsInt()
	@IsPositive()
	userId: number;
}

export class CreateGroupDto {
	@IsString()
	@MinLength(1)
	@MaxLength(GROUP_NAME_MAX_LENGTH)
	name: string;

	@ArrayMinSize(1)
	@ArrayMaxSize(GROUP_MAX_MEMBERS)
	@ArrayUnique()
	@IsInt({ each: true })
	@IsPositive({ each: true })
	memberUserIds: number[];
}

export class SendMessageDto {
	@IsString()
	@MinLength(1)
	@MaxLength(MESSAGE_BODY_MAX_LENGTH)
	body: string;
}

/** Cap so a slug can't be used to smuggle an oversized/garbage query string. */
const GIF_SLUG_MAX_LENGTH = 200;

/**
 * The client only ever sends back an opaque slug it saw in a prior
 * /chat/gifs/search response — never a url/width/height/title. ChatService
 * re-resolves the slug against Klipy before persisting anything (see
 * ChatService.sendGifMessage), so a client can never inject an arbitrary
 * image URL into someone else's chat.
 */
export class SendGifMessageDto {
	@IsString()
	@MinLength(1)
	@MaxLength(GIF_SLUG_MAX_LENGTH)
	slug: string;
}

export class AddGroupMemberDto {
	@IsInt()
	@IsPositive()
	userId: number;
}

/** Owner-only group rename — same name rules as CreateGroupDto (Decision 1). */
export class RenameGroupDto {
	@IsString()
	@MinLength(1)
	@MaxLength(GROUP_NAME_MAX_LENGTH)
	name: string;
}
