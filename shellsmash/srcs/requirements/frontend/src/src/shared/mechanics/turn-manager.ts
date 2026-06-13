/**
 * game/mechanics/turn-manager.ts — reusable turn state machine.
 *
 * Works for any turn-based 2-team game (Shell Curl, future games).
 * TurnState is plain-object serialisable so it can be sent over WebSocket
 * for a future network play implementation.
 *
 * Zero imports from any specific minigame directory.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type TurnPhase =
  | 'aiming'    // player is selecting power and dragging aim
  | 'sweeping'  // stone is in flight; player can sweep
  | 'settling'  // all stones decelerating; no input allowed
  | 'scoring'   // end finished; score overlay shown
  | 'gameover'; // all ends played

export interface TurnState {
  readonly currentTeam:  0 | 1;
  readonly currentEnd:   number;          // 0-indexed
  readonly stonesLeft:   readonly [number, number]; // [team0, team1] remaining this end
  readonly score:        readonly [number, number]; // cumulative [team0, team1]
  readonly phase:        TurnPhase;
  /** True when the current team has the last-stone advantage this end. */
  readonly hasHammer:    boolean;
}

// ── TurnManager ───────────────────────────────────────────────────────────────

export class TurnManager {
  private _state: TurnState;

  private readonly totalEnds:     number;
  private readonly stonesPerTeam: number;

  /** Which team holds the hammer (last-stone advantage) for the current end. */
  private hammerTeam: 0 | 1 = 0;

  constructor(opts: { totalEnds: number; stonesPerTeam: number }) {
    this.totalEnds     = opts.totalEnds;
    this.stonesPerTeam = opts.stonesPerTeam;

    this._state = {
      currentTeam: 0,
      currentEnd:  0,
      stonesLeft:  [opts.stonesPerTeam, opts.stonesPerTeam],
      score:       [0, 0],
      phase:       'aiming',
      hasHammer:   false, // team 0 throws first in end 0
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
  endEnd(scoringTeam: 0 | 1 | null, points: number): void {
    const score = [...this._state.score] as [number, number];
    if (scoringTeam !== null) {
      score[scoringTeam] += points;
      // TODO(#hammer): last-stone advantage: non-scoring team gets hammer next end
      this.hammerTeam = scoringTeam === 0 ? 1 : 0;
    }
    // else blank end — hammer unchanged

    const nextEnd = this._state.currentEnd + 1;
    const isOver  = nextEnd >= this.totalEnds;

    this._state = {
      ...this._state,
      currentEnd:  nextEnd,
      stonesLeft:  [this.stonesPerTeam, this.stonesPerTeam],
      score,
      currentTeam: this.hammerTeam === 0 ? 1 : 0, // hammer throws last → opponent first
      phase:       isOver ? 'gameover' : 'aiming',
      hasHammer:   false,
    };
  }

  /**
   * Advance to the next throw. Alternates between teams, consuming one stone
   * from the current team's stonesLeft. The team with the hammer always throws last.
   */
  nextThrow(): void {
    const s      = this._state;
    const stones = [s.stonesLeft[0], s.stonesLeft[1]] as [number, number];
    stones[s.currentTeam] = Math.max(0, stones[s.currentTeam] - 1);

    const next = this.upNext(stones);
    this._state = {
      ...s,
      stonesLeft:  stones,
      currentTeam: next,
      phase:       'aiming',
      hasHammer:   next === this.hammerTeam,
    };
  }

  /** True when the game is over (all ends played). */
  isGameOver(): boolean {
    return this._state.phase === 'gameover';
  }

  /** Who throws next given a stones-remaining tuple? Handles hammer ordering. */
  upNext(stonesLeft?: [number, number]): 0 | 1 {
    const sl = stonesLeft ?? [this._state.stonesLeft[0], this._state.stonesLeft[1]];
    // If only one team has stones left, they throw
    if (sl[0] > 0 && sl[1] === 0) return 0;
    if (sl[1] > 0 && sl[0] === 0) return 1;
    // Both have stones — alternate, but hammer team always throws last
    // Simple alternation: opposite of current team
    return this._state.currentTeam === 0 ? 1 : 0;
  }
}
