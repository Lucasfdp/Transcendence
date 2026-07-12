import { Injectable, Logger } from "@nestjs/common";
import { MatchRoom } from "./matchmaking.types";

/**
 * Coarse lifecycle transitions of a match.
 *
 * "cancelled" mirrors the `MatchStatus` union for forward compatibility but
 * has no runtime producer today (nothing in the codebase sets a match to
 * `cancelled`); it will only fire once such a path exists.
 */
export type MatchLifecycleEventType =
	| "started"
	| "finished"
	| "abandoned"
	| "cancelled";

export interface MatchLifecycleEvent {
	type: MatchLifecycleEventType;
	/**
	 * The in-memory room at the moment of the transition. For "finished" /
	 * "abandoned" the room is already closed and its outcome persisted
	 * (`state.winnerSide`, per-player outcomes in `match_players`).
	 * Listeners must treat it as read-only.
	 */
	room: MatchRoom;
}

export type MatchLifecycleListener = (event: MatchLifecycleEvent) => void;

/**
 * In-process observer for match lifecycle transitions.
 *
 * GameSessionService emits here after a match actually starts and after a
 * finished/abandoned match has been persisted (rewards granted, outcomes
 * written). There are deliberately no listeners yet — this exists so future
 * orchestrators (e.g. a tournament bracket) can react to match completion
 * without hooking into the gateway or duplicating end-of-match detection.
 *
 * Listener errors are swallowed and logged: a subscriber must never be able
 * to break the match flow that triggered the event. Events are best-effort
 * and in-memory only — they are not re-emitted after a process restart, so a
 * consumer that needs durability must reconcile from the `matches` table on
 * boot (the same way GameSessionService.onModuleInit does).
 */
@Injectable()
export class MatchLifecycleEvents {
	private readonly logger = new Logger(MatchLifecycleEvents.name);
	private readonly listeners = new Set<MatchLifecycleListener>();

	/** Register a listener. Returns an unsubscribe function. */
	subscribe(listener: MatchLifecycleListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: MatchLifecycleEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				this.logger.error(
					`Match lifecycle listener failed for ${event.type} (match ${event.room.matchId})`,
					err instanceof Error ? err.stack : String(err),
				);
			}
		}
	}
}
