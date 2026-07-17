/**
 * tournament-phase.ts — canonical Tournament phase list and transition graph
 * (SPEC-003, SPEC-001 "Máquina de estados").
 *
 * This graph is canonical (SPEC-001/SPEC-003); changing it requires an
 * approved ADR.
 *
 * Phases are UPPER_SNAKE_CASE string literals (SPEC-032). The transition
 * graph is DECLARATIVE DATA, not code: the state machine validates every
 * requested transition against `TOURNAMENT_PHASE_EDGES` — there is no giant
 * switch anywhere (SPEC-003 "Filosofía").
 *
 * CANCELLED is special-cased by DERIVATION instead of 13 duplicate edges:
 * it is legal from every non-terminal phase (SPEC-023 Match Lifecycle is the
 * only requester), so `isLegalTransition` grants it whenever the source
 * phase is non-terminal. The edge map itself only lists gameplay-flow edges.
 */

/** Canonical phase list, in SPEC-001 flow order (SPEC-032: UPPER_SNAKE_CASE). */
export const TOURNAMENT_PHASES = [
	"CREATED",
	"WAITING_PLAYERS",
	"INITIALIZING",
	"ROUND_START",
	"PLAYER_TURNS",
	"MINIGAME",
	"GAMBLING_PHASE",
	"CHECK_KEY_ITEMS",
	"BOSS_EVENT",
	"FINAL_CHALLENGE",
	"VICTORY",
	"REWARDS",
	"FINISHED",
	"DEFEAT",
	"CANCELLED",
] as const;

export type TournamentPhase = (typeof TOURNAMENT_PHASES)[number];

/** Terminal phases: no outgoing edges, ever (SPEC-003). */
export const TERMINAL_PHASES: readonly TournamentPhase[] = [
	"FINISHED",
	"CANCELLED",
];

export function isTerminalPhase(phase: TournamentPhase): boolean {
	return TERMINAL_PHASES.includes(phase);
}

/**
 * Declarative gameplay-flow edges (SPEC-001 "Máquina de estados",
 * SPEC-003 "Flujo"). CANCELLED never appears as a target here — see the
 * file header and `isLegalTransition`.
 *
 * Branches:
 * - PLAYER_TURNS → CHECK_KEY_ITEMS: all Key Items unlocked mid-round
 *   (minigame + gambling of that round are skipped).
 * - MINIGAME → CHECK_KEY_ITEMS: draw / cancelled without result / omitted
 *   (gambling skipped that round).
 * - CHECK_KEY_ITEMS → ROUND_START | BOSS_EVENT | DEFEAT: loop, all Key
 *   Items complete, or max round reached without them (anti-stall, D3).
 */
export const TOURNAMENT_PHASE_EDGES: Readonly<
	Record<TournamentPhase, readonly TournamentPhase[]>
> = Object.freeze({
	CREATED: ["WAITING_PLAYERS"],
	WAITING_PLAYERS: ["INITIALIZING"],
	INITIALIZING: ["ROUND_START"],
	ROUND_START: ["PLAYER_TURNS"],
	PLAYER_TURNS: ["MINIGAME", "CHECK_KEY_ITEMS"],
	MINIGAME: ["GAMBLING_PHASE", "CHECK_KEY_ITEMS"],
	GAMBLING_PHASE: ["CHECK_KEY_ITEMS"],
	CHECK_KEY_ITEMS: ["ROUND_START", "BOSS_EVENT", "DEFEAT"],
	BOSS_EVENT: ["FINAL_CHALLENGE"],
	FINAL_CHALLENGE: ["VICTORY"],
	VICTORY: ["REWARDS"],
	REWARDS: ["FINISHED"],
	DEFEAT: ["FINISHED"],
	FINISHED: [],
	CANCELLED: [],
});

/**
 * Whether `from → to` is a legal edge of the canonical graph.
 *
 * CANCELLED is derived, not listed: legal from every non-terminal phase
 * (SPEC-003 "Cancelled"). Terminal phases have no outgoing edges at all.
 */
export function isLegalTransition(
	from: TournamentPhase,
	to: TournamentPhase,
): boolean {
	if (isTerminalPhase(from)) {
		return false;
	}
	if (to === "CANCELLED") {
		return true;
	}
	return TOURNAMENT_PHASE_EDGES[from].includes(to);
}
