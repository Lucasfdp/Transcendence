/**
 * Re-export shim — PresenceService was moved to the shared PresenceModule so
 * that FriendsModule and UsersModule can import it without a circular
 * dependency.  All existing imports of './presence.service' continue to work
 * without modification.
 */
export { PresenceService } from '../presence/presence.service';
export type { SocketUser } from '../presence/presence.service';
