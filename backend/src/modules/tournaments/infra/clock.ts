/**
 * TournamentClock — SPEC-028 "Tiempo y timers".
 *
 * Every tournament timer (turn timeouts, interaction timeouts, Gambling,
 * watchdogs) is created through this injectable clock/scheduler owned by
 * the Runtime. Tournament systems NEVER call `setTimeout`/`clearTimeout`
 * or `Date.now` directly: `SystemClock` below is the ONLY place in the
 * whole tournament module allowed to touch them.
 *
 * Timeout expiry is an input event of the deterministic layer, which is
 * what lets `ManualClock` run full simulations (e.g. a "10-minute" turn
 * timeout) instantly, without real time.
 */

/** Opaque handle for a scheduled callback; pass it back to `cancel`. */
export interface TimerHandle {
	readonly id: number;
}

export interface TournamentClock {
	/** Current time in epoch milliseconds. */
	now(): number;
	/** Runs `callback` once after `delayMs`. */
	schedule(delayMs: number, callback: () => void): TimerHandle;
	/** Cancels a scheduled callback; no-op if already fired or cancelled. */
	cancel(handle: TimerHandle): void;
	/**
	 * Cancels every pending callback at once. Optional so bespoke test clocks
	 * keep compiling; used by `TournamentRuntime.dispose()` when a tournament
	 * reaches a terminal phase — each runtime owns its own clock instance, so
	 * this can never cancel another tournament's timers.
	 */
	cancelAll?(): void;
}

/**
 * Real-time implementation backed by `Date.now` + `setTimeout`.
 * The ONLY tournament code allowed to use them (see file header).
 */
export class SystemClock implements TournamentClock {
	private nextId = 1;
	private readonly timers = new Map<number, NodeJS.Timeout>();

	now(): number {
		return Date.now();
	}

	schedule(delayMs: number, callback: () => void): TimerHandle {
		const id = this.nextId++;
		const timeout = setTimeout(() => {
			this.timers.delete(id);
			callback();
		}, delayMs);
		this.timers.set(id, timeout);
		return { id };
	}

	cancel(handle: TimerHandle): void {
		const timeout = this.timers.get(handle.id);
		if (timeout !== undefined) {
			clearTimeout(timeout);
			this.timers.delete(handle.id);
		}
	}

	cancelAll(): void {
		for (const timeout of this.timers.values()) {
			clearTimeout(timeout);
		}
		this.timers.clear();
	}
}

interface PendingTimer {
	readonly id: number;
	readonly dueAt: number;
	/** Registration order — tie-breaker for same-dueAt timers (FIFO). */
	readonly seq: number;
	readonly callback: () => void;
}

/**
 * Virtual-time implementation for tests and simulations. Time only moves
 * when `advance(ms)` is called; due callbacks fire synchronously inside
 * `advance`, in scheduled-time order (ties FIFO by registration order).
 * Callbacks may schedule new timers: they are placed relative to the
 * current virtual time and fire within the same `advance` if due.
 * No real timers are used anywhere in this class.
 */
export class ManualClock implements TournamentClock {
	private current: number;
	private nextId = 1;
	private nextSeq = 1;
	private pending: PendingTimer[] = [];

	constructor(startMs = 0) {
		this.current = startMs;
	}

	now(): number {
		return this.current;
	}

	schedule(delayMs: number, callback: () => void): TimerHandle {
		const id = this.nextId++;
		this.pending.push({
			id,
			dueAt: this.current + Math.max(0, delayMs),
			seq: this.nextSeq++,
			callback,
		});
		return { id };
	}

	cancel(handle: TimerHandle): void {
		this.pending = this.pending.filter((timer) => timer.id !== handle.id);
	}

	cancelAll(): void {
		this.pending = [];
	}

	/**
	 * Moves virtual time forward by `ms`, firing every timer due within the
	 * window. While a callback runs, `now()` reports that timer's due time,
	 * so nested `schedule` calls land correctly in virtual time.
	 */
	advance(ms: number): void {
		if (ms < 0) {
			throw new Error("ManualClock.advance: ms must be >= 0");
		}
		const target = this.current + ms;
		for (;;) {
			const next = this.takeNextDue(target);
			if (next === undefined) {
				break;
			}
			this.current = Math.max(this.current, next.dueAt);
			next.callback();
		}
		this.current = target;
	}

	/**
	 * Removes and returns the earliest timer with `dueAt <= target`
	 * (ties broken FIFO by registration order), or undefined if none.
	 */
	private takeNextDue(target: number): PendingTimer | undefined {
		let nextIndex = -1;
		for (let i = 0; i < this.pending.length; i++) {
			const timer = this.pending[i];
			if (timer.dueAt > target) {
				continue;
			}
			if (
				nextIndex === -1 ||
				timer.dueAt < this.pending[nextIndex].dueAt ||
				(timer.dueAt === this.pending[nextIndex].dueAt &&
					timer.seq < this.pending[nextIndex].seq)
			) {
				nextIndex = i;
			}
		}
		if (nextIndex === -1) {
			return undefined;
		}
		return this.pending.splice(nextIndex, 1)[0];
	}
}
