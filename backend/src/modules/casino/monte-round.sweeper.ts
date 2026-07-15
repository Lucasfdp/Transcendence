import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import { MONTE_SWEEP_INTERVAL_MS } from "./monte-round.constants";
import { MonteRoundService } from "./monte-round.service";

/**
 * Background cleaner for abandoned Three-Shell Monte rounds.
 *
 * A round is debited at start and only settled when the player resolves it (or
 * next starts/resumes, which lazily expires stale ones). Without this, a player
 * who never comes back leaves a `pending` row with a debited stake until someone
 * happens to touch it. This ticks every {@link MONTE_SWEEP_INTERVAL_MS} and
 * books any round past its TTL as the loss it already is.
 *
 * Uses a plain interval + Nest lifecycle hooks rather than `@nestjs/schedule` to
 * avoid a new dependency. The interval is unref'd so it never keeps the process
 * alive on its own, and cleared on shutdown so no timer or in-flight promise
 * leaks (important for a clean test teardown and graceful exit).
 */
@Injectable()
export class MonteRoundSweeper implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(MonteRoundSweeper.name);
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly rounds: MonteRoundService) {}

	onModuleInit(): void {
		this.timer = setInterval(() => {
			void this.sweep();
		}, MONTE_SWEEP_INTERVAL_MS);
		// Don't let the sweeper alone hold the event loop open.
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** One sweep pass. Errors are logged, never thrown (a failed tick must not crash the app). */
	private async sweep(): Promise<void> {
		try {
			const expired = await this.rounds.expireStaleRounds();
			if (expired > 0) {
				this.logger.log(`Expired ${expired} stale Monte round(s)`);
			}
		} catch (err: unknown) {
			this.logger.error(
				"Monte round sweep failed",
				err instanceof Error ? err.stack : String(err),
			);
		}
	}
}
