/**
 * minigame.types.ts — ports and result types for Minigame Integration (SPEC-015).
 *
 * The Tournament is only a CONSUMER of the existing minigame platform (SPEC-015
 * "Principios"): it never implements gameplay, matchmaking or scoring. So this
 * module depends only on narrow PORTS — a launcher, a lifecycle subscription, a
 * reconciler and a catalog — satisfied by thin adapters over the real
 * MatchFactoryService / MatchLifecycleEvents / `matches` table at the NestJS
 * layer. The tournament coordinator never imports the matchmaking module: it
 * speaks only these structural contracts (SPEC-015 "Restricciones": integrate
 * through public APIs, never modify matchmaking).
 */

/** Per-player minigame outcome as reported by the platform (SPEC-015 "Resultado"). */
export type MinigameOutcome = "win" | "loss" | "draw" | "abandoned";

/** A request to launch one minigame match for a set of active players. */
export interface MinigameLaunchRequest {
	readonly tournamentId: string;
	readonly round: number;
	readonly minigameId: string;
	/** Active players (connected, non-abandoned) that will be seated (SPEC-015). */
	readonly playerIds: readonly number[];
}

/** Result of a launch attempt (SPEC-015 "Match Creation" / "Errores"). */
export type MinigameLaunchResult =
	| { readonly status: "launched"; readonly matchId: string }
	| { readonly status: "error"; readonly reason: string };

/**
 * The final outcome of a match, however it was learned — a lifecycle event OR
 * a watchdog reconciliation (SPEC-015 "Resultado"/"Watchdog"). `winnerId` is the
 * single winner or null (tie / no winner); `outcomes` is the per-player result.
 */
export interface MinigameFinalResult {
	readonly matchId: string;
	readonly winnerId: number | null;
	readonly outcomes: ReadonlyMap<number, MinigameOutcome>;
}

/** A coarse lifecycle signal for a specific match, adapted from the platform. */
export interface MinigameLifecycleSignal {
	readonly type: "started" | "finished" | "abandoned" | "cancelled";
	readonly matchId: string;
	/** Present for finished/abandoned: the resolved result. */
	readonly result?: MinigameFinalResult;
}

/**
 * Launches a match through the existing platform (SPEC-015 "Match Creation":
 * always `mode: casual`, server-initiated start). Never creates matches itself.
 */
export interface MinigameLauncherPort {
	launch(request: MinigameLaunchRequest): Promise<MinigameLaunchResult>;
}

/**
 * Subscribes to platform lifecycle transitions (SPEC-015 "Integración con
 * Runtime": listen to MatchLifecycleEvents; started/finished/abandoned). Returns
 * an unsubscribe function. The adapter maps the raw MatchRoom into a
 * MinigameLifecycleSignal so the Tournament never sees platform internals.
 */
export interface MinigameLifecyclePort {
	subscribe(listener: (signal: MinigameLifecycleSignal) => void): () => void;
}

/**
 * One-shot reconciliation against the `matches` table (SPEC-015 "Watchdog"):
 * when the watchdog expires, query the durable result once. Returns null when
 * no result exists (⇒ treat the match as cancelled, never a hang).
 */
export interface MinigameReconcilerPort {
	reconcile(matchId: string): Promise<MinigameFinalResult | null>;
}

/**
 * The candidate minigames that support EXACTLY `playerCount` active players
 * (SPEC-015 "Selección"/"Catálogo": obtained from the existing catalog, never a
 * duplicated list). Returns their ids; the coordinator picks one with the seed.
 */
export interface MinigameCatalogPort {
	candidates(playerCount: number): readonly string[];
}

/** Points a player earns from a minigame outcome (SPEC-024 minigameReward). */
export interface MinigameRewardSettings {
	readonly winner: number;
	readonly participant: number;
}

/**
 * The result the coordinator returns to the Runtime (SPEC-015 "Resultado").
 * `completed` carries the single winner (or null on a tie) to feed Gambling;
 * `skipped`/`cancelled` mean the round continues to CHECK_KEY_ITEMS with no
 * winner (SPEC-001) — `skipped` for pre-launch reasons (too few players, no
 * candidate), `cancelled` for a launch error / result-less match.
 */
export type MinigameRoundResult =
	| {
			readonly status: "completed";
			readonly minigameId: string;
			readonly matchId: string;
			readonly winnerId: number | null;
			readonly tie: boolean;
	  }
	| { readonly status: "skipped"; readonly reason: string }
	| { readonly status: "cancelled"; readonly reason: string };

/** JSON-safe snapshot of the Minigame coordinator (SPEC-015). */
export interface MinigameSnapshot {
	readonly tournamentId: string;
	/** Monotonic selection index, namespaced into the seed (determinism). */
	readonly selectionCount: number;
	/** The match currently awaited, if any. */
	readonly pendingMatchId: string | null;
}
