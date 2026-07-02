/**
 * game/mechanics/turn-manager.ts — reusable turn state machine.
 *
 * Works for turn-based curling-style games with one or more players.
 * TurnState is plain-object serialisable so it can be sent over WebSocket
 * for a future network play implementation.
 *
 * Zero imports from any specific minigame directory.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type TurnPhase =
	| "aiming" // player is selecting power and dragging aim
	| "sweeping" // stone is in flight; player can sweep
	| "settling" // all stones decelerating; no input allowed
	| "scoring" // end finished; score overlay shown
	| "gameover"; // all ends played

export interface TurnState {
	readonly currentTeam: number;
	readonly currentEnd: number; // 0-indexed
	readonly stonesLeft: readonly number[]; // remaining this end by player
	readonly score: readonly number[]; // cumulative score by player
	readonly phase: TurnPhase;
	/** True when the current team has the last-stone advantage this end. */
	readonly hasHammer: boolean;
}

// ── TurnManager ───────────────────────────────────────────────────────────────

export class TurnManager {
	private _state: TurnState;

	private readonly totalEnds: number;
	private readonly stonesPerTeam: number;
	private readonly playerCount: number;

	/** Which team holds the hammer (last-stone advantage) for the current end. */
	private hammerTeam = 0;

	constructor(opts: {
		totalEnds: number;
		stonesPerTeam: number;
		playerCount?: number;
	}) {
		this.totalEnds = opts.totalEnds;
		this.stonesPerTeam = opts.stonesPerTeam;
		this.playerCount = Math.max(1, opts.playerCount ?? 2);

		this._state = {
			currentTeam: 0,
			currentEnd: 0,
			stonesLeft: Array.from(
				{ length: this.playerCount },
				() => opts.stonesPerTeam,
			),
			score: Array.from({ length: this.playerCount }, () => 0),
			phase: "aiming",
			hasHammer: false, // team 0 throws first in end 0
		};
	}

	get state(): TurnState {
		return this._state;
	}

	/** Transition to a new phase without changing any other state. */
	setPhase(phase: TurnPhase): void {
		this._state = { ...this._state, phase };
	}

	/**
	 * Record points scored by `scoringTeam` this end, advance to the next end,
	 * and reset stonesLeft. The team that did NOT score gets the hammer next end
	 * (last-stone advantage). If both scored 0 (blank end), hammer does not change.
	 */
	endEnd(scoringTeam: number | null, points: number): void {
		const score = [...this._state.score];
		if (scoringTeam !== null) {
			score[scoringTeam] += points;
			// TODO(#hammer): last-stone advantage: non-scoring team gets hammer next end
			this.hammerTeam = (scoringTeam + 1) % this.playerCount;
		}
		// else blank end — hammer unchanged

		const nextEnd = this._state.currentEnd + 1;
		const isOver = nextEnd >= this.totalEnds;

		const firstTeam = (this.hammerTeam + 1) % this.playerCount;

		this._state = {
			...this._state,
			currentEnd: nextEnd,
			stonesLeft: Array.from(
				{ length: this.playerCount },
				() => this.stonesPerTeam,
			),
			score,
			currentTeam: firstTeam, // hammer throws last in the circular order
			phase: isOver ? "gameover" : "aiming",
			hasHammer: false,
		};
	}

	/**
	 * Advance to the next throw. Alternates between teams, consuming one stone
	 * from the current team's stonesLeft. The team with the hammer always throws last.
	 */
	nextThrow(): void {
		const s = this._state;
		const stones = [...s.stonesLeft];
		stones[s.currentTeam] = Math.max(0, stones[s.currentTeam] - 1);

		const next = this.upNext(stones);
		this._state = {
			...s,
			stonesLeft: stones,
			currentTeam: next,
			phase: "aiming",
			hasHammer: next === this.hammerTeam,
		};
	}

	/** True when the game is over (all ends played). */
	isGameOver(): boolean {
		return this._state.phase === "gameover";
	}

	/** Who throws next given a stones-remaining tuple? Handles hammer ordering. */
	upNext(stonesLeft?: number[]): number {
		const sl = stonesLeft ?? [...this._state.stonesLeft];
		for (let offset = 1; offset <= this.playerCount; offset++) {
			const candidate =
				(this._state.currentTeam + offset) % this.playerCount;
			if (sl[candidate] > 0) return candidate;
		}
		return this._state.currentTeam;
	}
}
