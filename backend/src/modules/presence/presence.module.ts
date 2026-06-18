import { Module } from "@nestjs/common";
import { PresenceService } from "./presence.service";

/**
 * PresenceModule — shared, globally-importable module that tracks which user
 * IDs have live WebSocket connections.
 *
 * Extracted from MatchmakingModule so that FriendsModule and UsersModule can
 * inject PresenceService without creating a circular dependency.
 */
@Module({
	providers: [PresenceService],
	exports: [PresenceService],
})
export class PresenceModule {}
