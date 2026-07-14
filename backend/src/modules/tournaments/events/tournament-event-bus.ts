/**
 * tournament-event-bus.ts — typed, in-process event bus (SPEC-004).
 *
 * ONE INSTANCE PER TOURNAMENT. Not Socket.IO, not the global
 * @nestjs/event-emitter: a small self-contained class (same spirit as
 * MatchLifecycleEvents in the matchmaking module) with guaranteed emission
 * order and per-listener error isolation.
 *
 * The bus only registers listeners, emits and distributes events, and keeps
 * their order. It contains zero gameplay/business logic, never modifies
 * state, never decides anything, and knows nothing about Nest DI, sockets,
 * the database or any other tournament system.
 */

import { Logger } from "@nestjs/common";
import {
	AnyTournamentEvent,
	TournamentEvent,
	TournamentEventName,
} from "./tournament-event.types";

/** Listener for one concrete event type. */
export type TournamentEventListener<TName extends TournamentEventName> = (
	event: TournamentEvent<TName>,
) => void;

/**
 * Infrastructure-only tap (networking snapshots, analytics, logging).
 * Read-only by contract: events arrive frozen and taps must never mutate
 * or drive gameplay from here.
 */
export type TournamentAnyEventListener = (event: AnyTournamentEvent) => void;

/** Receives every listener failure and every dropped over-budget emission. */
export type TournamentEventBusErrorHandler = (
	eventName: TournamentEventName,
	error: unknown,
) => void;

export interface TournamentEventBusOptions {
	/**
	 * Injectable error sink. Defaults to a Nest Logger error line. Errors
	 * are reported here and NEVER rethrown into the emitter.
	 */
	onListenerError?: TournamentEventBusErrorHandler;
	/**
	 * Cycle guard budget: maximum accepted emissions of the SAME event name
	 * within one synchronous drain. Rationale: SPEC-004 forbids a listener
	 * from provoking (directly or indirectly) a new emission of the event
	 * type it is processing; a hard once-per-chain rule would false-drop
	 * legitimate repeated facts (e.g. one PointsAwarded per player in a
	 * single chain), so the guard cuts off runaway same-name emission loops
	 * at this budget instead. Default: 16.
	 */
	maxSameNameEmissionsPerDrain?: number;
}

const DEFAULT_MAX_SAME_NAME_EMISSIONS_PER_DRAIN = 16;

/** Internal, type-erased listener shape (the public API restores the types). */
type ErasedListener = (event: AnyTournamentEvent) => void;

export class TournamentEventBus {
	private readonly logger = new Logger(TournamentEventBus.name);
	private readonly onListenerError: TournamentEventBusErrorHandler;

	private readonly listeners = new Map<
		TournamentEventName,
		Set<ErasedListener>
	>();
	private readonly anyListeners = new Set<TournamentAnyEventListener>();

	/** FIFO queue of accepted, not-yet-dispatched events. */
	private readonly queue: AnyTournamentEvent[] = [];
	/** True while the drain loop is dispatching (re-entrant emit → queue). */
	private draining = false;
	/**
	 * Accepted emissions per event name within the current drain. Used by
	 * the cycle guard: once a name exhausts its budget, further emissions
	 * of that name in the same drain are reported and dropped.
	 */
	private readonly emissionCounts = new Map<TournamentEventName, number>();
	private readonly maxSameNameEmissionsPerDrain: number;

	constructor(options: TournamentEventBusOptions = {}) {
		this.maxSameNameEmissionsPerDrain =
			options.maxSameNameEmissionsPerDrain ??
			DEFAULT_MAX_SAME_NAME_EMISSIONS_PER_DRAIN;
		this.onListenerError =
			options.onListenerError ??
			((eventName, error): void => {
				this.logger.error(
					`Tournament event listener error for ${eventName}`,
					error instanceof Error ? error.stack : String(error),
				);
			});
	}

	/**
	 * Registers a listener for one event type. Returns an unsubscribe
	 * function (calling it twice is a no-op).
	 *
	 * Within the dispatch of a single event, listeners run in registration
	 * order — deterministically, but this is NOT a contract (SPEC-004:
	 * never depend on listener registration order).
	 */
	on<TName extends TournamentEventName>(
		eventName: TName,
		listener: TournamentEventListener<TName>,
	): () => void {
		let set = this.listeners.get(eventName);
		if (!set) {
			set = new Set<ErasedListener>();
			this.listeners.set(eventName, set);
		}
		set.add(listener as ErasedListener);
		return () => this.off(eventName, listener);
	}

	/** Removes a previously registered listener (no-op if absent). */
	off<TName extends TournamentEventName>(
		eventName: TName,
		listener: TournamentEventListener<TName>,
	): void {
		this.listeners.get(eventName)?.delete(listener as ErasedListener);
	}

	/**
	 * Single wildcard tap for infrastructure (the only wildcard in v1).
	 * Called AFTER the event's specific listeners, with the same error
	 * isolation. Returns an unsubscribe function.
	 */
	onAny(listener: TournamentAnyEventListener): () => void {
		this.anyListeners.add(listener);
		return () => {
			this.anyListeners.delete(listener);
		};
	}

	/**
	 * Emits an event. Events are dispatched strictly in emission order, one
	 * at a time: if a listener emits while a dispatch is in progress, the
	 * new event is queued and dispatched after the current one completes
	 * (FIFO drain loop) — never interleaved, never recursively.
	 *
	 * Cycle guard (SPEC-004 "Nunca crear ciclos"): each event name has an
	 * emission budget per drain (`maxSameNameEmissionsPerDrain`). Repeated
	 * same-name facts within one chain are legitimate up to the budget; an
	 * emission beyond it — the signature of a listener re-emitting the event
	 * type it is processing in a loop — is reported to onListenerError and
	 * DROPPED, terminating the runaway chain. Counters reset when the drain
	 * completes, so independent later emissions are unaffected.
	 *
	 * Immutability: the envelope and its first level of nesting (payload,
	 * metadata) are frozen on emit. Deeper structures (e.g. arrays inside
	 * the payload) are not frozen — payloads must stay shallow.
	 */
	emit(event: AnyTournamentEvent): void {
		const count = (this.emissionCounts.get(event.name) ?? 0) + 1;
		if (count > this.maxSameNameEmissionsPerDrain) {
			this.onListenerError(
				event.name,
				new Error(
					`Event cycle / runaway emission suspected: "${event.name}" exceeded the budget of ${this.maxSameNameEmissionsPerDrain} same-name emissions in one drain; the emission was dropped (SPEC-004).`,
				),
			);
			return;
		}
		this.emissionCounts.set(event.name, count);

		Object.freeze(event.payload);
		Object.freeze(event.metadata);
		Object.freeze(event);
		this.queue.push(event);

		if (this.draining) {
			return;
		}
		this.draining = true;
		try {
			while (this.queue.length > 0) {
				const next = this.queue.shift();
				if (!next) {
					break;
				}
				this.dispatch(next);
			}
		} finally {
			this.draining = false;
			this.emissionCounts.clear();
			this.queue.length = 0;
		}
	}

	/**
	 * Invokes the event's specific listeners (registration order), then the
	 * onAny taps. Listener sets are snapshotted first: (un)subscribing
	 * during a dispatch never affects the event currently being delivered.
	 * A throwing listener is reported and never stops the remaining ones.
	 */
	private dispatch(event: AnyTournamentEvent): void {
		const specific = this.listeners.get(event.name);
		if (specific) {
			for (const listener of [...specific]) {
				this.invoke(listener, event);
			}
		}
		for (const listener of [...this.anyListeners]) {
			this.invoke(listener, event);
		}
	}

	private invoke(listener: ErasedListener, event: AnyTournamentEvent): void {
		try {
			listener(event);
		} catch (error) {
			try {
				this.onListenerError(event.name, error);
			} catch {
				// The error sink itself must never break the dispatch.
			}
		}
	}
}
