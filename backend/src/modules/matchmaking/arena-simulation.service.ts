import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { GameSessionService } from "./game-session.service";
import { RoomService } from "./room.service";

const ARENA_SIMULATION_TICK_MS = 1_000 / 30;
const ARENA_STATE_BROADCAST_MS = 100;
const REPLAY_SAMPLE_MS = 50;

/**
 * Fixed-rate server physics loop for the arena games.
 *
 * Advances every active room's simulation at 30 Hz (via the engine's optional
 * `advanceSimulation`) and asks the caller to broadcast a snapshot at 10 Hz
 * per room while the simulation is actually changing. Extracted from
 * MatchmakingGateway so the tick/pacing responsibility lives outside the
 * socket handler class; the gateway stays the only place that touches
 * Socket.IO, which is why the broadcast side is a callback rather than a
 * server reference.
 */
@Injectable()
export class ArenaSimulationService implements OnModuleDestroy {
	private timer: NodeJS.Timeout | null = null;
	private readonly broadcastElapsedMs = new Map<string, number>();
	private readonly replayElapsedMs = new Map<string, number>();

	constructor(
		private readonly rooms: RoomService,
		private readonly sessions: GameSessionService,
	) {}

	/** Start the 30 Hz loop. Idempotent — a second call keeps the first timer. */
	start(broadcast: (matchId: string) => void): void {
		this.timer ??= setInterval(
			() => this.tick(broadcast),
			ARENA_SIMULATION_TICK_MS,
		);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.broadcastElapsedMs.clear();
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
			if (
				!this.sessions.advanceSimulation(room, ARENA_SIMULATION_TICK_MS)
			)
				continue;
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
			if (elapsed < ARENA_STATE_BROADCAST_MS) {
				this.broadcastElapsedMs.set(room.matchId, elapsed);
				continue;
			}
			this.broadcastElapsedMs.set(
				room.matchId,
				elapsed - ARENA_STATE_BROADCAST_MS,
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
}
