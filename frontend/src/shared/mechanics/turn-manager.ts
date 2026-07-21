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
	| "sweeping" // ball is in flight; player can sweep
	| "settling" // all balls decelerating; no input allowed
	| "scoring" // end finished; score overlay shown
	| "gameover"; // all ends played

export interface TurnState {
	readonly currentTeam: number;
	readonly currentEnd: number; // 0-indexed
	readonly ballsLeft: readonly number[]; // remaining this end by player
	readonly score: readonly number[]; // cumulative score by player
	readonly phase: TurnPhase;
	/** True when the current team has the last-ball advantage this end. */
	readonly hasHammer: boolean;
	/**
	 * The player (by `side`/colour index) who takes the FIRST turn this
	 * match — undefined/0 for a game with no turn order (or a local match,
	 * always player 0). `ScoreHud` displays players starting from this seat
	 * instead of always side 0, so the scoreboard reads left-to-right in
	 * actual play order; each player's colour still comes from their own
	 * `side`, untouched, so a match that starts elsewhere never reassigns
	 * "who is blue".
	 */
	readonly firstPlayer?: number;
}

/**
 * The seat shown at scoreboard display slot `slot` (0 = leftmost), given the
 * match's first-turn player: display slots run in PLAY order rather than
 * always raw side order, so `ScoreHud` reads left-to-right as the match is
 * actually played. `firstPlayer` defaults to 0, making this the identity
 * mapping — a complete no-op for a game with no turn order, or a local match.
 * Each seat's colour/score/label always come from the returned SIDE, never
 * from `slot` — only a seat's on-screen POSITION moves, never its identity.
 */
export function seatAtDisplaySlot(
	slot: number,
	playerCount: number,
	firstPlayer = 0,
): number {
	const n = Math.max(1, playerCount);
	return (firstPlayer + slot) % n;
}

// ── TurnManager ───────────────────────────────────────────────────────────────

export class TurnManager {
	private _state: TurnState;

	private readonly totalEnds: number;
	private readonly ballsPerTeam: number;
	private readonly playerCount: number;

	/** Which team holds the hammer (last-ball advantage) for the current end. */
	private hammerTeam = 0;

	constructor(opts: {
		totalEnds: number;
		ballsPerTeam: number;
		playerCount?: number;
	}) {
		this.totalEnds = opts.totalEnds;
		this.ballsPerTeam = opts.ballsPerTeam;
		this.playerCount = Math.max(1, opts.playerCount ?? 2);

		this._state = {
			currentTeam: 0,
			currentEnd: 0,
			ballsLeft: Array.from(
				{ length: this.playerCount },
				() => opts.ballsPerTeam,
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
	 * and reset ballsLeft. The team that did NOT score gets the hammer next end
	 * (last-ball advantage). If both scored 0 (blank end), hammer does not change.
	 */
	endEnd(scoringTeam: number | null, points: number): void {
		const score = [...this._state.score];
		if (scoringTeam !== null) {
			score[scoringTeam] += points;
			// TODO(#hammer): last-ball advantage: non-scoring team gets hammer next end
			this.hammerTeam = (scoringTeam + 1) % this.playerCount;
		}
		// else blank end — hammer unchanged

		const nextEnd = this._state.currentEnd + 1;
		const isOver = nextEnd >= this.totalEnds;

		const firstTeam = (this.hammerTeam + 1) % this.playerCount;

		this._state = {
			...this._state,
			currentEnd: nextEnd,
			ballsLeft: Array.from(
				{ length: this.playerCount },
				() => this.ballsPerTeam,
			),
			score,
			currentTeam: firstTeam, // hammer throws last in the circular order
			phase: isOver ? "gameover" : "aiming",
			hasHammer: false,
		};
	}

	/**
	 * Advance to the next throw. Alternates between teams, consuming one ball
	 * from the current team's ballsLeft. The team with the hammer always throws last.
	 */
	nextThrow(): void {
		const s = this._state;
		const balls = [...s.ballsLeft];
		balls[s.currentTeam] = Math.max(0, balls[s.currentTeam] - 1);

		const next = this.upNext(balls);
		this._state = {
			...s,
			ballsLeft: balls,
			currentTeam: next,
			phase: "aiming",
			hasHammer: next === this.hammerTeam,
		};
	}

	/** True when the game is over (all ends played). */
	isGameOver(): boolean {
		return this._state.phase === "gameover";
	}

	/** Who throws next given a balls-remaining tuple? Handles hammer ordering. */
	upNext(ballsLeft?: number[]): number {
		const remaining = ballsLeft ?? [...this._state.ballsLeft];
		for (let offset = 1; offset <= this.playerCount; offset++) {
			const candidate =
				(this._state.currentTeam + offset) % this.playerCount;
			if (remaining[candidate] > 0) return candidate;
		}
		return this._state.currentTeam;
	}
}
