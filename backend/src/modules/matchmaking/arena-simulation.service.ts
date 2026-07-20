import { Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { MetricsService } from "../metrics/metrics.service";
import { GameSessionService } from "./game-session.service";
import { RoomService } from "./room.service";

const ARENA_SIMULATION_TICK_MS = 1_000 / 30;
// R9: simulate at 30 Hz but broadcast at 20 Hz. Previously this equalled the
// tick interval, so the decimation accumulator below always concluded "broadcast
// now" (dead logic). Decimating to 20 Hz cuts steady-state physics bandwidth by
// a third, which the client's 100–180 ms jitter-adaptive interpolation buffer
// absorbs with no visible cost. Settling bursts still broadcast immediately (see
// the `settled` fast-path in `tick`).
const ARENA_STATE_BROADCAST_MS = 1_000 / 20;
const MAX_CATCH_UP_STEPS = 5;
const REPLAY_SAMPLE_MS = 50;

/**
 * Fixed-rate server physics loop for the arena games.
 *
 * Advances every active room's simulation at 30 Hz (via the engine's optional
 * `advanceSimulation`) and asks the caller to broadcast each moving step per
 * room. Extracted from
 * MatchmakingGateway so the tick/pacing responsibility lives outside the
 * socket handler class; the gateway stays the only place that touches
 * Socket.IO, which is why the broadcast side is a callback rather than a
 * server reference.
 */
@Injectable()
export class ArenaSimulationService implements OnModuleDestroy {
	private timer: NodeJS.Timeout | null = null;
	private readonly broadcastElapsedMs = new Map<string, number>();
	private accumulatorMs = 0;
	private lastTickAt = 0;
	private readonly replayElapsedMs = new Map<string, number>();

	constructor(
		private readonly rooms: RoomService,
		private readonly sessions: GameSessionService,
		// Optional so unit tests can construct the service without the metrics
		// stack; a no-op when absent.
		@Optional() private readonly metrics?: MetricsService,
	) {}

	/** Start the 30 Hz loop. Idempotent — a second call keeps the first timer. */
	start(broadcast: (matchId: string) => void): void {
		if (this.timer) return;
		this.lastTickAt = performance.now();
		this.timer = setInterval(
			() => this.runFixedSteps(broadcast),
			ARENA_SIMULATION_TICK_MS,
		);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.broadcastElapsedMs.clear();
		this.accumulatorMs = 0;
		this.lastTickAt = 0;
		this.replayElapsedMs.clear();
	}

	onModuleDestroy(): void {
		this.stop();
	}

	/** One simulation step over all active rooms. Public for tests. */
	tick(broadcast: (matchId: string) => void): void {
		const activeMatchIds = new Set<string>();
		for (const room of this.rooms.getActiveRooms()) {
			activeMatchIds.add(room.matchId);
			if (!this.sessions.advanceSimulation(room, ARENA_SIMULATION_TICK_MS)) {
				if (room.physicsState && !this.broadcastElapsedMs.has(room.matchId)) {
					this.broadcastElapsedMs.set(room.matchId, 0);
					broadcast(room.matchId);
				}
				continue;
			}
			const replayElapsed =
				(this.replayElapsedMs.get(room.matchId) ?? 0) +
				ARENA_SIMULATION_TICK_MS;
			if (replayElapsed >= REPLAY_SAMPLE_MS) {
				this.replayElapsedMs.set(
					room.matchId,
					replayElapsed - REPLAY_SAMPLE_MS,
				);
				this.sessions.captureReplayFrame(room, REPLAY_SAMPLE_MS);
			} else {
				this.replayElapsedMs.set(room.matchId, replayElapsed);
			}
			const elapsed =
				(this.broadcastElapsedMs.get(room.matchId) ?? 0) +
				ARENA_SIMULATION_TICK_MS;
			const settled =
				room.physicsState !== undefined &&
				room.physicsState.entities.every((entity) => entity.stopped);
			if (elapsed < ARENA_STATE_BROADCAST_MS && !settled) {
				this.broadcastElapsedMs.set(room.matchId, elapsed);
				continue;
			}
			this.broadcastElapsedMs.set(
				room.matchId,
				settled ? 0 : elapsed - ARENA_STATE_BROADCAST_MS,
			);
			broadcast(room.matchId);
		}
		for (const matchId of this.broadcastElapsedMs.keys()) {
			if (!activeMatchIds.has(matchId))
				this.broadcastElapsedMs.delete(matchId);
		}
		for (const matchId of this.replayElapsedMs.keys()) {
			if (!activeMatchIds.has(matchId))
				this.replayElapsedMs.delete(matchId);
		}
	}

	private runFixedSteps(broadcast: (matchId: string) => void): void {
		const now = performance.now();
		this.accumulatorMs += Math.min(
			now - this.lastTickAt,
			ARENA_SIMULATION_TICK_MS * MAX_CATCH_UP_STEPS,
		);
		this.lastTickAt = now;
		let steps = 0;
		const pendingBroadcasts = new Set<string>();
		while (
			this.accumulatorMs >= ARENA_SIMULATION_TICK_MS &&
			steps < MAX_CATCH_UP_STEPS
		) {
			this.tick((matchId) => pendingBroadcasts.add(matchId));
			this.accumulatorMs -= ARENA_SIMULATION_TICK_MS;
			steps += 1;
		}
		for (const matchId of pendingBroadcasts) broadcast(matchId);
		this.recordMetrics(performance.now() - now);
	}

	/**
	 * Publish real-time simulation metrics for this pass (observability): pass
	 * duration, live rooms, buffered replay frames, and any catch-up steps the
	 * loop had to drop because it saturated (accumulated time still exceeding a
	 * full tick after MAX_CATCH_UP_STEPS — the server clock is falling behind
	 * wall clock, R7). No-op when the metrics stack is absent (tests).
	 */
	private recordMetrics(passDurationMs: number): void {
		if (!this.metrics) return;
		this.metrics.observeArenaTick(passDurationMs / 1000);
		const droppedSteps = Math.floor(
			this.accumulatorMs / ARENA_SIMULATION_TICK_MS,
		);
		this.metrics.incDroppedCatchUpSteps(droppedSteps);
		let activeRooms = 0;
		let replayFrames = 0;
		for (const room of this.rooms.getActiveRooms()) {
			activeRooms += 1;
			replayFrames += room.replayFrames.length;
		}
		this.metrics.setSimulationGauges(activeRooms, replayFrames);
	}
}
