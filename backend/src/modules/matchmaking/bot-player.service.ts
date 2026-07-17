/**
 * bot-player.service.ts — server-side CPU players for the arena minigames.
 *
 * A bot seat is a RoomPlayer whose socketId carries the `bot:` prefix — today
 * they are seated ONLY by the Tournament's minigame adapter as stand-ins for
 * participants with no live connection (and, next wave, for CPU tournament
 * participants). Public-queue / private-lobby matches never contain bot seats.
 *
 * Bots play through EXACTLY the same rail as human clients —
 * `MatchmakingGateway.handleUserInput` — so every engine validation, throw
 * broadcast, replay capture and end-of-match settlement applies unchanged. A
 * bot cannot do anything a modified human client could not.
 *
 * Since every game's scoring is client-reported (the engines trust the acting
 * client's hit/settle reports), a bot IS its own client: it reports plausible
 * outcomes drawn from the same value ranges real clients produce
 * (bell zones 50–200/hit, kame `target.points × combo`, bamboo stage points,
 * curling settled stone positions scored server-side). Skill knobs live in
 * BOT_SKILL below — a future balance pass tunes them (D2/F8).
 *
 * If a human reconnects mid-match, `RoomService.reconnect` replaces the seat's
 * socketId with the real one — the `bot:` prefix disappears and the driver
 * stops acting for that seat automatically.
 *
 * Timing uses plain timers/Math.random on purpose: this is the matchmaking
 * layer (like ArenaSimulationService's interval), NOT the deterministic
 * tournament engine core.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { MatchmakingGateway } from "./matchmaking.gateway";
import {
	BambooBashSnapshot,
	BellClashSnapshot,
	CurlingSnapshot,
	GameInputPayload,
	KameKnockSnapshot,
	MatchRoom,
	RoomPlayer,
} from "./matchmaking.types";
import { getArenaBallSpawn } from "./replay-state.helpers";
import { RoomService } from "./room.service";

/** Socket-id prefix marking a server-driven seat. */
export const BOT_SOCKET_PREFIX = "bot:";

/** A seat currently played by the server (self-clears on human reconnect). */
export const isBotSeat = (player: RoomPlayer): boolean =>
	player.socketId.startsWith(BOT_SOCKET_PREFIX);

/** Driver cadence; per-action pacing is randomized per step (human-ish). */
const BOT_TICK_MS = 400;

/**
 * Skill/pacing knobs (single tuning surface for the balance pass).
 * Values are grounded in what real clients produce.
 */
const BOT_SKILL = {
	/** Delay before a bot acts on a new obligation (ms, min..max jitter). */
	actDelayMs: [1200, 2600] as const,
	/** Delay between a throw and its reported result (ms). */
	resolveDelayMs: [700, 1400] as const,
	/** temple-curling: stddev of the settled stone around the button (norm.). */
	curlingSigma: 0.055,
	/** kame-knock: chance a throw breaks the aimed target. */
	kameHitChance: 0.55,
	/** bell-clash: chance a shot lands a zone at all. */
	bellHitChance: 0.7,
	/** bell-clash: per-hit points as real zones yield (50/100/150/200). */
	bellPoints: [50, 100, 150, 200] as const,
	/** bamboo-bash: chance each throw fells the aimed bamboo. */
	bambooHitChance: 0.6,
} as const;

/** Curling geometry (mirror of shell-curl.engine.ts constants). */
const CURL_HOUSE = { x: (1570 - 380) / 1570, y: 0.5 };

type SeatStage = "idle" | "released" | "reported";

interface SeatPlan {
	stage: SeatStage;
	nextActionAt: number;
	/** kame: the target this throw aims at. */
	targetId: number | null;
	/** bell/bamboo per-round bookkeeping key to detect round rollover. */
	roundKey: string;
}

const randomBetween = (range: readonly [number, number]): number =>
	range[0] + Math.random() * (range[1] - range[0]);

const gaussian = (): number => {
	// Box–Muller; good enough for aim noise.
	const u = Math.max(Math.random(), 1e-9);
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

@Injectable()
export class BotPlayerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(BotPlayerService.name);
	private timer: NodeJS.Timeout | null = null;
	private readonly plans = new Map<string, SeatPlan>();

	constructor(
		private readonly rooms: RoomService,
		private readonly gateway: MatchmakingGateway,
	) {}

	onModuleInit(): void {
		this.timer = setInterval(() => void this.tick(), BOT_TICK_MS);
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.plans.clear();
	}

	/** One pass over the active rooms; public for tests. */
	async tick(): Promise<void> {
		const activeMatchIds = new Set<string>();
		for (const room of this.rooms.getActiveRooms()) {
			activeMatchIds.add(room.matchId);
			for (const player of room.players) {
				if (!isBotSeat(player)) continue;
				await this.stepSeat(room, player);
			}
		}
		// Drop plans of rooms that ended (results already settled by the rail).
		for (const key of [...this.plans.keys()]) {
			if (!activeMatchIds.has(key.split("|")[0])) {
				this.plans.delete(key);
			}
		}
	}

	// ── Per-seat stepping ────────────────────────────────────────────────────

	private async stepSeat(room: MatchRoom, player: RoomPlayer): Promise<void> {
		const plan = this.planFor(room, player);
		const now = Date.now();
		if (now < plan.nextActionAt) return;

		try {
			switch (room.gameId) {
				case "temple-curling":
					await this.playCurling(room, player, plan, now);
					break;
				case "kame-knock":
					await this.playKameKnock(room, player, plan, now);
					break;
				case "bell-clash":
					await this.playBellClash(room, player, plan, now);
					break;
				case "bamboo-bash":
					await this.playBambooBash(room, player, plan, now);
					break;
				default:
					break;
			}
		} catch (err) {
			// Never break the tick loop — a failed input is retried next pass.
			this.logger.error(
				`bot step failed (match ${room.matchId}, side ${player.side})`,
				err instanceof Error ? err.stack : String(err),
			);
			plan.nextActionAt = now + 1500;
		}
	}

	private planFor(room: MatchRoom, player: RoomPlayer): SeatPlan {
		const key = `${room.matchId}|${player.side}`;
		let plan = this.plans.get(key);
		if (!plan) {
			plan = {
				stage: "idle",
				nextActionAt: Date.now() + randomBetween(BOT_SKILL.actDelayMs),
				targetId: null,
				roundKey: "",
			};
			this.plans.set(key, plan);
		}
		return plan;
	}

	private send(
		player: RoomPlayer,
		room: MatchRoom,
		action: GameInputPayload["action"],
		payload: Record<string, unknown>,
	): Promise<unknown> {
		return this.gateway.handleUserInput(player.user.id, {
			matchId: room.matchId,
			action,
			payload,
		} as GameInputPayload);
	}

	// ── temple-curling (turn-based; server scores the settled stones) ────────

	private async playCurling(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as CurlingSnapshot;
		if (state.phase !== "active" || state.currentTurn !== player.side) {
			plan.stage = "idle";
			return;
		}

		const hasOwnStone = state.objects.some(
			(object) => object.id === state.turnNumber,
		);

		if (plan.stage === "idle" && !hasOwnStone) {
			// Aim at the button; the velocity only drives spectator animation —
			// the settled report below is what the engine scores.
			const aimX = CURL_HOUSE.x + gaussian() * BOT_SKILL.curlingSigma;
			const aimY = CURL_HOUSE.y + gaussian() * BOT_SKILL.curlingSigma;
			await this.send(player, room, "release", {
				vx: (aimX - 90 / 1570) * 1.6,
				vy: (aimY - 0.5) * 1.6,
				power: "none",
			});
			plan.stage = "released";
			plan.targetId = state.turnNumber;
			plan.nextActionAt = now + randomBetween(BOT_SKILL.resolveDelayMs) + 900;
			return;
		}

		if (plan.stage === "released" || hasOwnStone) {
			// Report the settled board: previous stones stay where they were,
			// the new stone lands near the button with skill noise.
			const settledX = Math.min(
				1,
				Math.max(0, CURL_HOUSE.x + gaussian() * BOT_SKILL.curlingSigma),
			);
			const settledY = Math.min(
				1,
				Math.max(0, CURL_HOUSE.y + gaussian() * BOT_SKILL.curlingSigma * 1.5),
			);
			const objects = state.objects.map((object) =>
				object.id === state.turnNumber
					? {
							id: object.id,
							side: object.side,
							x: settledX,
							y: settledY,
							vx: 0,
							vy: 0,
							stopped: true,
						}
					: {
							id: object.id,
							side: object.side,
							x: object.x,
							y: object.y,
							vx: 0,
							vy: 0,
							stopped: true,
						},
			);
			await this.send(player, room, "settled", {
				turnNumber: state.turnNumber,
				objects,
			});
			plan.stage = "idle";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
		}
	}

	// ── kame-knock (turn-based; client-reported target hits) ─────────────────

	private async playKameKnock(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as KameKnockSnapshot;
		if (state.phase !== "active" || state.currentTurn !== player.side) {
			plan.stage = "idle";
			return;
		}

		if (plan.stage === "idle" && state.activeTurnNumber === null) {
			// Aim at the highest-value breakable target still standing.
			const target = [...state.targets]
				.filter((candidate) => candidate.breakable)
				.sort((a, b) => b.points - a.points)[0];
			plan.targetId = target?.id ?? null;
			const spawn = getArenaBallSpawn(state, player.side);
			await this.send(player, room, "release", {
				roundNumber: state.roundNumber,
				turnNumber: state.turnNumber,
				x: spawn.x,
				y: spawn.y,
				vx: ((target?.nx ?? 0) - spawn.x) * 2,
				vy: ((target?.ny ?? 0) - spawn.y) * 2,
			});
			plan.stage = "released";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.resolveDelayMs);
			return;
		}

		if (plan.stage === "released" && state.activeTurnNumber === state.turnNumber) {
			if (plan.targetId !== null && Math.random() < BOT_SKILL.kameHitChance) {
				await this.send(player, room, "target:hit", {
					roundNumber: state.roundNumber,
					turnNumber: state.turnNumber,
					targetId: plan.targetId,
					combo: 1,
					perfect: false,
				});
			}
			plan.stage = "reported";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.resolveDelayMs);
			return;
		}

		if (plan.stage === "reported" && state.activeTurnNumber === state.turnNumber) {
			await this.send(player, room, "settled", {
				roundNumber: state.roundNumber,
				turnNumber: state.turnNumber,
				stopped: true,
			});
			plan.stage = "idle";
			plan.targetId = null;
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
		}
	}

	// ── bell-clash (simultaneous shots; client-reported zone points) ─────────

	private async playBellClash(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as BellClashSnapshot;
		if (state.phase !== "active") return;
		const roundKey = `bell:${state.roundNumber}`;
		if (plan.roundKey !== roundKey) {
			plan.roundKey = roundKey;
			plan.stage = "idle";
		}
		if (state.roundScores[player.side] !== null) return; // round locked in

		const shots = state.shotCounts[player.side] ?? 0;

		if (shots >= state.shotsPerRound) {
			await this.send(player, room, "round:score", {
				roundNumber: state.roundNumber,
			});
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
			return;
		}

		if (plan.stage === "idle") {
			const spawn = getArenaBallSpawn(state, player.side);
			// Fling toward the bell at the arena center.
			await this.send(player, room, "release", {
				roundNumber: state.roundNumber,
				x: spawn.x,
				y: spawn.y,
				vx: -spawn.x * 1.5,
				vy: -spawn.y * 1.5,
			});
			plan.stage = "released";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.resolveDelayMs);
			return;
		}

		if (plan.stage === "released") {
			if (Math.random() < BOT_SKILL.bellHitChance) {
				const points =
					BOT_SKILL.bellPoints[
						Math.floor(Math.random() * BOT_SKILL.bellPoints.length)
					];
				await this.send(player, room, "bell:hit", {
					roundNumber: state.roundNumber,
					points,
					zoneKind: "yellow",
				});
			}
			plan.stage = "idle";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
		}
	}

	// ── bamboo-bash (simultaneous timed round; client-reported fells) ────────

	private async playBambooBash(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as BambooBashSnapshot;
		if (state.phase !== "active") return;
		const roundKey = `bamboo:${state.roundNumber}`;
		if (plan.roundKey !== roundKey) {
			plan.roundKey = roundKey;
			plan.stage = "idle";
		}
		if (state.roundScores[player.side] !== null) return; // round locked in

		// Round clock elapsed: lock in the accumulated live score.
		if (state.roundEndsAt !== null && now >= state.roundEndsAt) {
			await this.send(player, room, "round:score", {
				roundNumber: state.roundNumber,
				score: state.liveRoundScores[player.side] ?? 0,
			});
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
			return;
		}

		if (plan.stage === "idle") {
			// Aim at the ripest bamboo (highest stage = most points).
			const bamboo = [...state.bamboos].sort((a, b) => b.stage - a.stage)[0];
			plan.targetId = bamboo?.id ?? null;
			const spawn = getArenaBallSpawn(state, player.side);
			await this.send(player, room, "release", {
				roundNumber: state.roundNumber,
				x: spawn.x,
				y: spawn.y,
				vx: ((bamboo?.nx ?? 0) - spawn.x) * 2,
				vy: ((bamboo?.ny ?? 0) - spawn.y) * 2,
			});
			plan.stage = "released";
			plan.nextActionAt = now + randomBetween(BOT_SKILL.resolveDelayMs);
			return;
		}

		if (plan.stage === "released") {
			if (plan.targetId !== null && Math.random() < BOT_SKILL.bambooHitChance) {
				await this.send(player, room, "bamboo:hit", {
					roundNumber: state.roundNumber,
					bambooId: plan.targetId,
					stopped: true,
				});
			}
			plan.stage = "idle";
			plan.targetId = null;
			plan.nextActionAt = now + randomBetween(BOT_SKILL.actDelayMs);
		}
	}
}
