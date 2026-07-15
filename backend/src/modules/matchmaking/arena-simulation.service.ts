import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { GameSessionService } from "./game-session.service";
import { RoomService } from "./room.service";

const ARENA_SIMULATION_TICK_MS = 1_000 / 30;
const ARENA_STATE_BROADCAST_MS = ARENA_SIMULATION_TICK_MS;
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
		while (
			this.accumulatorMs >= ARENA_SIMULATION_TICK_MS &&
			steps < MAX_CATCH_UP_STEPS
		) {
			this.tick(broadcast);
			this.accumulatorMs -= ARENA_SIMULATION_TICK_MS;
			steps += 1;
		}
	}
}
