/**
 * tournament-minigame.adapter.ts — the SOCKET-BOUND adapter satisfying the
 * four SPEC-015 minigame ports over the REAL platform (SPEC-015 "Principios":
 * the Tournament is only a consumer — it never implements gameplay,
 * matchmaking or scoring, and it integrates through public APIs only):
 *
 * - `MinigameCatalogPort`   → `GameEngineRegistry.list()` (the ONE game
 *   catalog; ids are never duplicated here) filtered by player-count bounds.
 * - `MinigameLauncherPort`  → `MatchFactoryService.createMatch` (mode
 *   `casual`, SPEC-015 "Match Creation") + the platform's single
 *   server-initiated launch rail `MatchmakingGateway.startServerInitiatedMatch`
 *   with the `tournament:minigame-start` client notification.
 * - `MinigameLifecyclePort` → `MatchLifecycleEvents.subscribe`, mapping the
 *   raw MatchRoom into a `MinigameLifecycleSignal` (winner from
 *   `state.winnerSide` → seat → userId) so the Tournament never sees
 *   matchmaking internals.
 * - `MinigameReconcilerPort`→ one-shot read of the durable `matches` +
 *   `match_players` rows (SPEC-015 "Watchdog").
 */

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MatchFactoryService, MatchPlayerInput } from "../matchmaking/match-factory.service";
import { MatchLifecycleEvents } from "../matchmaking/match-lifecycle.events";
import { MatchmakingGateway } from "../matchmaking/matchmaking.gateway";
import { GameEngineRegistry } from "../matchmaking/engines/game-engine.registry";
import { Match } from "../matchmaking/entities/match.entity";
import { MatchPlayer } from "../matchmaking/entities/match-player.entity";
import { MatchRoom } from "../matchmaking/matchmaking.types";
import { BOT_SOCKET_PREFIX } from "../matchmaking/bot-player.service";
import { PresenceService } from "../presence/presence.service";
import { User } from "../users/entities/user.entity";
import {
	MinigameCatalogPort,
	MinigameFinalResult,
	MinigameLaunchRequest,
	MinigameLaunchResult,
	MinigameLauncherPort,
	MinigameLifecyclePort,
	MinigameLifecycleSignal,
	MinigameOutcome,
	MinigameReconcilerPort,
} from "./minigame/minigame.types";

@Injectable()
export class TournamentMinigameAdapter
	implements
		MinigameLauncherPort,
		MinigameLifecyclePort,
		MinigameReconcilerPort,
		MinigameCatalogPort
{
	private readonly logger = new Logger(TournamentMinigameAdapter.name);

	constructor(
		private readonly matchFactory: MatchFactoryService,
		private readonly matchLifecycle: MatchLifecycleEvents,
		private readonly matchmakingGateway: MatchmakingGateway,
		private readonly engineRegistry: GameEngineRegistry,
		private readonly presence: PresenceService,
		@InjectRepository(Match)
		private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
	) {}

	// ── MinigameCatalogPort ──────────────────────────────────────────────────

	candidates(playerCount: number): readonly string[] {
		return this.engineRegistry
			.list()
			.filter(
				(engine) =>
					engine.minPlayers <= playerCount && playerCount <= engine.maxPlayers,
			)
			.map((engine) => engine.gameId);
	}

	// ── MinigameLauncherPort ─────────────────────────────────────────────────

	async launch(request: MinigameLaunchRequest): Promise<MinigameLaunchResult> {
		// Seat every player: from a live socket when connected; otherwise as a
		// CPU STAND-IN (`bot:` socket, played server-side by BotPlayerService) so
		// one offline participant never blocks the round's minigame — the
		// outcome stays credited to the real user. Bot seats exist ONLY on
		// tournament-launched matches (this adapter is their sole producer).
		const players: MatchPlayerInput[] = [];
		for (const userId of request.playerIds) {
			const socketId = this.presence.getSocketIds(userId)[0];
			const user = socketId ? this.presence.getUser(socketId) : null;
			if (socketId && user) {
				// Tournament minigames carry no cosmetic shell picks (v1): empty
				// selection, same default the entity uses.
				players.push({ socketId, user, shellSelection: [] });
				continue;
			}
			const standIn = await this.buildStandIn(userId);
			if (!standIn) {
				return { status: "error", reason: `player ${userId} does not exist` };
			}
			players.push(standIn);
		}

		try {
			const room = await this.matchFactory.createMatch({
				gameId: request.minigameId,
				mode: "casual",
				players,
			});
			await this.matchmakingGateway.startServerInitiatedMatch(
				room,
				"tournament:minigame-start",
			);
			this.logger.log(
				`tournament ${request.tournamentId} launched minigame ${request.minigameId} as match ${room.matchId}`,
			);
			return { status: "launched", matchId: room.matchId };
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`tournament ${request.tournamentId} minigame launch failed: ${reason}`,
			);
			return { status: "error", reason };
		}
	}

	// ── MinigameLifecyclePort ────────────────────────────────────────────────

	subscribe(listener: (signal: MinigameLifecycleSignal) => void): () => void {
		return this.matchLifecycle.subscribe((event) => {
			const matchId = event.room.matchId;
			if (event.type === "started") {
				listener({ type: "started", matchId });
				return;
			}
			if (event.type === "finished" || event.type === "abandoned") {
				listener({
					type: event.type,
					matchId,
					result: this.resultFromRoom(event.room),
				});
				return;
			}
			listener({ type: "cancelled", matchId });
		});
	}

	// ── MinigameReconcilerPort ───────────────────────────────────────────────

	async reconcile(matchId: string): Promise<MinigameFinalResult | null> {
		const match = await this.matchRepo.findOne({ where: { id: matchId } });
		if (!match || (match.status !== "finished" && match.status !== "abandoned")) {
			return null;
		}
		const rows = await this.matchPlayerRepo.find({ where: { matchId } });
		const outcomes = new Map<number, MinigameOutcome>();
		let winnerId: number | null = null;
		for (const row of rows) {
			if (row.userId === null) continue;
			const outcome: MinigameOutcome = row.outcome ?? "draw";
			outcomes.set(row.userId, outcome);
			if (outcome === "win") {
				winnerId = row.userId;
			}
		}
		return { matchId, winnerId, outcomes };
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * A CPU stand-in seat for an offline participant: `bot:`-prefixed socket
	 * id (the BotPlayerService marker) + the real user's identity from the
	 * users table so minigame outcomes/points credit the right account.
	 */
	private async buildStandIn(userId: number): Promise<MatchPlayerInput | null> {
		const user = await this.userRepo.findOne({ where: { id: userId } });
		if (!user) {
			return null;
		}
		this.logger.log(`seating CPU stand-in for offline user ${userId}`);
		return {
			socketId: `${BOT_SOCKET_PREFIX}${userId}`,
			user: {
				id: user.id,
				username: user.username,
				turtleName: user.turtleName ?? null,
				shellSkin: user.shellSkin ?? "base",
				trailEffect: user.trailEffect ?? "trail_classic",
				hubBackground: user.hubBackground ?? "night_bg",
				hubBackgroundAlter: user.hubBackgroundAlter ?? null,
				isGuest: user.isGuest,
			},
			shellSelection: [],
		};
	}

	/** Winner = `state.winnerSide` → seated player → userId (F4 seam audit). */
	private resultFromRoom(room: MatchRoom): MinigameFinalResult {
		const winnerSide =
			(room.state as { winnerSide?: number | null } | undefined)?.winnerSide ??
			null;
		const outcomes = new Map<number, MinigameOutcome>();
		let winnerId: number | null = null;
		for (const player of room.players) {
			const isWinner = winnerSide !== null && player.side === winnerSide;
			if (isWinner) {
				winnerId = player.user.id;
			}
			outcomes.set(
				player.user.id,
				isWinner ? "win" : winnerSide === null ? "draw" : "loss",
			);
		}
		return { matchId: room.matchId, winnerId, outcomes };
	}
}
