/**
 * tournament-shell.ts — ¡¡THE PARROT'S SHELL!! as match state (SPEC-013
 * "ShellReward" / SPEC-021 "Recompensa").
 *
 * ONE INSTANCE PER TOURNAMENT holding the single Shell: who owns it (nobody
 * until the Final Challenge resolves). It is the real backing for the Reward
 * Resolver's `grantShell` Action (previously a forward-seam no-op) and the SOLE
 * EMITTER of ShellGranted. Exactly one Shell exists — a second grant is
 * rejected and logged, never thrown (the Resolver surfaces the failed Action).
 *
 * Determinism (SPEC-028): no randomness; event timestamps come only from the
 * injected clock.
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { ShellGrantResult, ShellSnapshot } from "./final-challenge.types";

export interface TournamentShellOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	readonly getRound?: () => number;
}

export class TournamentShell {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	private holderId: number | null = null;

	constructor(options: TournamentShellOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Shell") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Shell" });
		this.getRound = options.getRound ?? (() => 0);
	}

	/**
	 * Grants the ONE Shell to `winnerId` and emits ShellGranted (SPEC-021
	 * "Victoria"). A second grant is rejected (logged, never thrown) — the match
	 * ends immediately after the Shell is obtained, so this only guards bugs.
	 */
	grant(winnerId: number): ShellGrantResult {
		if (this.holderId !== null) {
			this.logger.warn("shell grant rejected: already granted", {
				playerId: winnerId,
				metadata: { holderId: this.holderId },
			});
			return { status: "rejected", reason: "already_granted" };
		}
		this.holderId = winnerId;
		const event = createTournamentEvent({
			name: "ShellGranted",
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId: winnerId,
			payload: { winnerId },
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
		this.logger.log("THE PARROT'S SHELL granted", { playerId: winnerId });
		return { status: "granted", winnerId };
	}

	getHolderId(): number | null {
		return this.holderId;
	}

	serialize(): ShellSnapshot {
		return { tournamentId: this.tournamentId, holderId: this.holderId };
	}
}
