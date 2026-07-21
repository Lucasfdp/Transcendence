/**
 * bot-player.service.ts — server-side CPU players for the arena minigames.
 *
 * A bot seat is a RoomPlayer whose socketId carries the `bot:` prefix. They are
 * seated by the Tournament's minigame adapter as stand-ins for participants with
 * no live connection, and — since P5 — by the abandon flow, which hands a leaving
 * seat in a 3+ player match to a CPU stand-in so the match plays on for everyone
 * else. Any bot seat in an active room is driven here regardless of how it was
 * seated.
 *
 * Bots play through EXACTLY the same rail as human clients —
 * `MatchmakingGateway.handleUserInput` — so every engine validation, throw
 * broadcast, replay capture and end-of-match settlement applies unchanged. A
 * bot cannot do anything a modified human client could not.
 *
 * The engines are server-authoritative: the ONLY input a client (and therefore
 * a bot) can send is `release` with a launch velocity — the fixed server
 * simulation resolves travel, collisions, hits, scoring and round/turn
 * completion. A bot's whole game is therefore aiming: it picks a target point,
 * adds gaussian scatter, and converts the aim distance into a launch speed
 * using the same friction model the physics integrates (per-frame factor `f`
 * over 16.67 ms frames makes a shot travel ≈ v0 · 0.01667 / (1 − f) units).
 * Skill knobs live in BOT_SKILL below — a future balance pass tunes them (D2/F8).
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
	BOT_SOCKET_PREFIX,
	CurlingSnapshot,
	GameInputPayload,
	isBotSeat,
	KameKnockSnapshot,
	MatchRoom,
	ReplayFrameSnapshotEntity,
	RoomPlayer,
} from "./matchmaking.types";
import { RoomService } from "./room.service";

// These moved to their dependency-free home (`matchmaking.types`) to break a
// cycle; re-exported here so existing importers keep working unchanged.
export { BOT_SOCKET_PREFIX, isBotSeat };

/** Driver cadence; per-action pacing is randomized per throw (human-ish). */
const BOT_TICK_MS = 400;

/**
 * Skill/pacing knobs (single tuning surface for the balance pass).
 * Aim scatter is in source-space pixels of each game's physics sheet.
 */
const BOT_SKILL = {
	/** Delay between a bot's throws (ms, min..max jitter). */
	actDelayMs: [1200, 2600] as const,
	/** Extra human-ish pause after a round's countdown, before the first move
	 *  of that round (ms, min..max jitter). */
	roundStartDelayMs: [1_000, 3_000] as const,
	/** Retry delay after the engine rejects an input (ms). */
	rejectRetryMs: 800,
	/** temple-curling: aim scatter around the button (px). */
	curlingSigmaPx: 60,
	/** kame-knock: aim scatter around the chosen target (px). */
	kameSigmaPx: 55,
	/** bell-clash: aim scatter around the bell centre (px). */
	bellSigmaPx: 45,
	/** bamboo-bash: aim scatter around the chosen bamboo (px). */
	bambooSigmaPx: 55,
	/** Multiplicative jitter on every computed launch speed. */
	speedJitter: [0.9, 1.12] as const,
} as const;

/**
 * Geometry/friction mirrors of the server physics (shell-curl-physics.ts and
 * the shared arena physics of kame/bell/bamboo). Travel seconds = the
 * closed-form distance a shot covers per unit of launch speed under the
 * per-frame friction factor: 0.01667 / (1 − f).
 */
const CURL = {
	sheetW: 1570,
	sheetH: 880,
	deliveryX: 90,
	deliveryY: 440,
	houseX: 1190,
	houseY: 440,
	travelSeconds: 0.01667 / (1 - 0.99),
} as const;
const ARENA = {
	rx: 705,
	ry: 491,
	travelSeconds: 0.01667 / (1 - 0.985),
	bellSpawnRadius: 320,
	bambooSpawnRadius: 0.22 * 705,
} as const;
const MAX_LAUNCH_SPEED = 5_000;

interface SeatPlan {
	nextActionAt: number;
}

const randomBetween = (range: readonly [number, number]): number =>
	range[0] + Math.random() * (range[1] - range[0]);

const gaussian = (): number => {
	// Box–Muller; good enough for aim noise.
	const u = Math.max(Math.random(), 1e-9);
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Launch velocity that lands `[dx, dy]` away under the friction model. */
const launchVelocity = (
	dx: number,
	dy: number,
	travelSeconds: number,
): { vx: number; vy: number } => {
	const distance = Math.max(1, Math.hypot(dx, dy));
	const speed = Math.min(
		MAX_LAUNCH_SPEED * 0.9,
		(distance / travelSeconds) * randomBetween(BOT_SKILL.speedJitter),
	);
	return { vx: (dx / distance) * speed, vy: (dy / distance) * speed };
};

/**
 * Server-side stand-in for the clients' "3, 2, 1, GO!" opener: once every
 * real seat has genuinely entered the arena (see `ARENA_ENTRY_TIMEOUT_MS`
 * below), bots additionally hold for this long, so a CPU can never move
 * while the slowest-to-load human is still watching the countdown. Matches
 * the shared 3.2 s countdown with a small buffer.
 */
const BOT_START_COUNTDOWN_HOLD_MS = 5_000;

/**
 * A server-initiated launch (tournament minigame, private lobby, rematch —
 * `startServerInitiatedMatch`) marks every seat `ready` and the room "active"
 * the instant the match is CREATED, long before any client has actually
 * navigated to the arena and mounted its Phaser scene — there is no
 * server-side signal of that at all otherwise. Bots hold until every real
 * (non-bot) seat has sent `game:arena-ready`, so the match genuinely waits
 * for every player to enter before anything can move — not merely a guessed
 * navigation delay (which could easily be shorter than a real page load,
 * letting a CPU move while a slow client's screen is still blank).
 * Bounded by this backstop (matching the platform's other arrival gates,
 * e.g. the tournament's MINIGAME TIME! confirmation deadline) so a client
 * that never loads in — a crashed tab, a lost connection — can never block
 * the match forever.
 */
const ARENA_ENTRY_TIMEOUT_MS = 20_000;

/**
 * The client replays the same "3, 2, 1, GO!" beat at every round/end boundary,
 * not just at match start (see `runStartCountdown` callers in each Scene). The
 * engines advance `roundNumber`/`currentEnd` the instant a round ends — there
 * is no server-side delay to ride out — so without this hold a bot's next
 * `nextActionAt` (set right after its last throw) could fire mid-countdown.
 * Matches the shared countdown's 4 steps × 800 ms. Applied per seat (see
 * `armRoundHold`) so each bot's post-countdown pause is rolled independently —
 * a shared room-wide hold would clear for every bot on the same tick and they
 * would still all move at once.
 */
const BOT_ROUND_COUNTDOWN_HOLD_MS = 3_200;

@Injectable()
export class BotPlayerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(BotPlayerService.name);
	private timer: NodeJS.Timeout | null = null;
	private readonly plans = new Map<string, SeatPlan>();
	/** matchId → when bots may start acting (the countdown hold). */
	private readonly roomHoldUntil = new Map<string, number>();
	/** matchId → last round/end key seen, to detect round boundaries. */
	private readonly roomRoundKey = new Map<string, number>();

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
		this.roomHoldUntil.clear();
		this.roomRoundKey.clear();
	}

	/**
	 * One pass over the active rooms; public for tests.
	 *
	 * Rankings Bug Audit §3.3: `onModuleInit` fires this from a bare
	 * `setInterval(() => void this.tick(), …)` — a synchronous throw anywhere
	 * in this body (not just inside `stepSeat`, which already guards its own
	 * per-seat work) becomes a floating, un-awaited promise rejection that
	 * kills the Node process. The whole body is wrapped so the tick loop can
	 * never take the backend down; a failed pass is simply retried next tick.
	 */
	async tick(): Promise<void> {
		try {
			const activeMatchIds = new Set<string>();
			for (const room of this.rooms.getActiveRooms()) {
				activeMatchIds.add(room.matchId);
				const now = Date.now();
				const roundKey = this.roundKeyFor(room);
				// Match the clients' "3, 2, 1, GO!": bots sit out the countdown
				// window after the room goes active, so nothing moves before GO.
				let holdUntil = this.roomHoldUntil.get(room.matchId);
				if (holdUntil === undefined) {
					// Wait for every real seat to actually load into the arena (or
					// the backstop, for a client that never shows up) before even
					// starting the countdown-hold clock — arming it at match
					// creation (room.createdAt) would let the floor expire while a
					// slow client is still mid-navigation, with nothing to load yet.
					const armedAt = room.createdAt ?? now;
					const ready =
						this.allRealSeatsEntered(room) ||
						now - armedAt >= ARENA_ENTRY_TIMEOUT_MS;
					if (!ready) continue;
					holdUntil = now + BOT_START_COUNTDOWN_HOLD_MS;
					this.roomHoldUntil.set(room.matchId, holdUntil);
				} else {
					// The same countdown replays at every round/end boundary too —
					// re-arm each bot seat's own plan independently (see
					// `armRoundHold`) rather than a shared room hold, so bots don't
					// all resume on the same tick once it clears.
					const lastRoundKey = this.roomRoundKey.get(room.matchId);
					if (
						roundKey !== null &&
						lastRoundKey !== undefined &&
						roundKey !== lastRoundKey
					) {
						this.armRoundHold(room, now);
					}
				}
				if (roundKey !== null) this.roomRoundKey.set(room.matchId, roundKey);

				if (now < holdUntil) continue;
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
			for (const matchId of [...this.roomHoldUntil.keys()]) {
				if (!activeMatchIds.has(matchId)) {
					this.roomHoldUntil.delete(matchId);
					this.roomRoundKey.delete(matchId);
				}
			}
		} catch (err) {
			this.logger.error(
				"bot tick failed",
				err instanceof Error ? err.stack : String(err),
			);
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

	/** Every non-bot seat has sent `game:arena-ready` for this match. */
	private allRealSeatsEntered(room: MatchRoom): boolean {
		return room.players.every(
			(player) => isBotSeat(player) || room.enteredUserIds.has(player.user.id),
		);
	}

	/**
	 * The round/end number a room's state is currently on, or `null` for a
	 * game with no round concept (or one that doesn't need the round-boundary
	 * hold — see below). Used to detect the boundary where the client replays
	 * "3, 2, 1, GO!".
	 *
	 * kame-knock is deliberately excluded: it's strictly turn-based (only the
	 * seat whose turn it is can ever act), so there's no "every bot fires at
	 * once" risk at a round boundary the way there is in Bell Clash/Bamboo
	 * Bash — the match-start hold above is the only pacing it needs.
	 */
	private roundKeyFor(room: MatchRoom): number | null {
		switch (room.gameId) {
			case "temple-curling":
				return (room.state as CurlingSnapshot).currentEnd;
			case "bell-clash":
				return (room.state as BellClashSnapshot).roundNumber;
			case "bamboo-bash":
				return (room.state as BambooBashSnapshot).roundNumber;
			default:
				return null;
		}
	}

	/**
	 * Re-arms every bot seat's own plan for a fresh round/end: hold through the
	 * countdown, then an INDEPENDENTLY rolled 1–3 s pause per seat, so bots in
	 * the same room don't all take their first shot of the round on the same
	 * tick — the countdown itself is a shared beat, but nothing after it
	 * should be.
	 */
	private armRoundHold(room: MatchRoom, now: number): void {
		for (const player of room.players) {
			if (!isBotSeat(player)) continue;
			this.planFor(room, player).nextActionAt =
				now +
				BOT_ROUND_COUNTDOWN_HOLD_MS +
				randomBetween(BOT_SKILL.roundStartDelayMs);
		}
	}

	private planFor(room: MatchRoom, player: RoomPlayer): SeatPlan {
		const key = `${room.matchId}|${player.side}`;
		let plan = this.plans.get(key);
		if (!plan) {
			plan = {
				nextActionAt: Date.now() + randomBetween(BOT_SKILL.actDelayMs),
			};
			this.plans.set(key, plan);
		}
		return plan;
	}

	private async release(
		player: RoomPlayer,
		room: MatchRoom,
		plan: SeatPlan,
		now: number,
		payload: Record<string, unknown>,
	): Promise<void> {
		const ack = (await this.gateway.handleUserInput(player.user.id, {
			matchId: room.matchId,
			action: "release",
			payload,
		} as GameInputPayload)) as { accepted?: boolean } | undefined;
		plan.nextActionAt =
			now +
			(ack?.accepted
				? randomBetween(BOT_SKILL.actDelayMs)
				: BOT_SKILL.rejectRetryMs);
	}

	/** The seat's own projectile as the server last broadcast it (normalized). */
	private ownEntity(
		state: { entities: ReplayFrameSnapshotEntity[] },
		side: number,
	): ReplayFrameSnapshotEntity | null {
		return (
			state.entities.find((candidate) => candidate.ownerSide === side) ??
			null
		);
	}

	// ── temple-curling (turn-based; server physics scores the stones) ────────

	private async playCurling(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as CurlingSnapshot;
		if (state.phase !== "active" || state.currentTurn !== player.side)
			return;
		// The engine rejects a release while any stone still slides.
		if (state.activeBallId !== null) return;

		const targetX = CURL.houseX + gaussian() * BOT_SKILL.curlingSigmaPx;
		const targetY =
			CURL.houseY + gaussian() * BOT_SKILL.curlingSigmaPx * 1.5;
		const { vx, vy } = launchVelocity(
			targetX - CURL.deliveryX,
			targetY - CURL.deliveryY,
			CURL.travelSeconds,
		);
		await this.release(player, room, plan, now, { vx, vy, power: "none" });
	}

	// ── kame-knock (turn-based; shots launch from the arena centre) ──────────

	private async playKameKnock(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as KameKnockSnapshot;
		if (state.phase !== "active" || state.currentTurn !== player.side)
			return;
		if (state.activeTurnNumber !== null) return;

		// Aim at the highest-value breakable target still standing.
		const target = [...state.targets]
			.filter((candidate) => candidate.breakable)
			.sort((a, b) => b.points - a.points)[0];
		const targetX =
			(target?.nx ?? 0) * ARENA.rx + gaussian() * BOT_SKILL.kameSigmaPx;
		const targetY =
			(target?.ny ?? 0) * ARENA.ry + gaussian() * BOT_SKILL.kameSigmaPx;
		const { vx, vy } = launchVelocity(targetX, targetY, ARENA.travelSeconds);
		await this.release(player, room, plan, now, {
			roundNumber: state.roundNumber,
			turnNumber: state.turnNumber,
			vx,
			vy,
		});
	}

	// ── bell-clash (simultaneous shots at the centre bell) ───────────────────

	private async playBellClash(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as BellClashSnapshot;
		if (state.phase !== "active") return;
		if (state.roundScores[player.side] !== null) return; // round locked in
		if ((state.shotCounts[player.side] ?? 0) >= state.shotsPerRound) return;

		// Re-shots launch from where the previous shell stopped; the first shot
		// of a round launches from the seat's rim spawn (engine-side formula).
		const own = this.ownEntity(state, player.side);
		if (own && !own.stopped) return;
		const spawnAngle =
			-Math.PI / 2 +
			(player.side / Math.max(1, room.players.length)) * Math.PI * 2;
		const originX = own
			? own.x * ARENA.rx
			: Math.cos(spawnAngle) * ARENA.bellSpawnRadius;
		const originY = own
			? own.y * ARENA.ry
			: Math.sin(spawnAngle) * ARENA.bellSpawnRadius;
		const targetX = gaussian() * BOT_SKILL.bellSigmaPx;
		const targetY = gaussian() * BOT_SKILL.bellSigmaPx;
		// Overshoot past the bell so the impact rings it instead of dying short.
		const { vx, vy } = launchVelocity(
			(targetX - originX) * 1.4,
			(targetY - originY) * 1.4,
			ARENA.travelSeconds,
		);
		await this.release(player, room, plan, now, {
			roundNumber: state.roundNumber,
			vx,
			vy,
		});
	}

	// ── bamboo-bash (timed round; server clock locks the scores in) ──────────

	private async playBambooBash(
		room: MatchRoom,
		player: RoomPlayer,
		plan: SeatPlan,
		now: number,
	): Promise<void> {
		const state = room.state as BambooBashSnapshot;
		if (state.phase !== "active") return;
		if (state.roundScores[player.side] !== null) return; // round locked in

		const own = this.ownEntity(state, player.side);
		if (own && !own.stopped) return;

		// Aim at the ripest bamboo (highest stage = most points).
		const bamboo = [...state.bamboos].sort((a, b) => b.stage - a.stage)[0];
		const sideCount = Math.max(1, room.players.length);
		const spawnAngle =
			sideCount === 2
				? player.side === 0
					? Math.PI
					: 0
				: -Math.PI / 2 + (player.side / sideCount) * Math.PI * 2;
		const originX = own
			? own.x * ARENA.rx
			: Math.cos(spawnAngle) * ARENA.bambooSpawnRadius;
		const originY = own
			? own.y * ARENA.ry
			: Math.sin(spawnAngle) * ARENA.bambooSpawnRadius;
		const targetX =
			(bamboo?.nx ?? 0) * ARENA.rx + gaussian() * BOT_SKILL.bambooSigmaPx;
		const targetY =
			(bamboo?.ny ?? 0) * ARENA.ry + gaussian() * BOT_SKILL.bambooSigmaPx;
		const { vx, vy } = launchVelocity(
			targetX - originX,
			targetY - originY,
			ARENA.travelSeconds,
		);
		await this.release(player, room, plan, now, {
			roundNumber: state.roundNumber,
			vx,
			vy,
		});
	}
}
