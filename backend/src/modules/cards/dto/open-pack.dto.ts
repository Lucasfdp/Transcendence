import { IsIn, IsOptional } from "class-validator";
import { PACK_TIER_IDS, type PackTierId } from "../cards.constants";

/**
 * Body for POST /cards/packs/open. `tierId` is optional so existing
 * clients/tests that call the endpoint bare keep defaulting to "basic"
 * (enforced in {@link CardsController.openPack}).
 */
export class OpenPackDto {
	@IsOptional()
	@IsIn(PACK_TIER_IDS)
	tierId?: PackTierId;
}
