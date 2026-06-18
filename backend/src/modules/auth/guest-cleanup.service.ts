import {
	Injectable,
	Logger,
	OnModuleInit,
	OnModuleDestroy,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { RateLimiterService } from "./rate-limiter.service";

/** Guest accounts older than this are deleted. */
const GUEST_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
/** How often to run the cleanup pass. */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every 1 hour

/**
 * Replaces @nestjs/schedule which cannot be installed in this environment.
 * Runs a periodic cleanup of expired guest accounts via setInterval.
 */
@Injectable()
export class GuestCleanupService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(GuestCleanupService.name);
	private intervalId: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly usersService: UsersService,
		private readonly rateLimiter: RateLimiterService,
	) {}

	onModuleInit(): void {
		this.intervalId = setInterval(async () => {
			await this.runCleanup();
		}, CLEANUP_INTERVAL_MS);

		this.logger.log(
			`Guest cleanup scheduled — TTL ${GUEST_TTL_MS / 3_600_000}h, ` +
				`interval ${CLEANUP_INTERVAL_MS / 3_600_000}h`,
		);
	}

	onModuleDestroy(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/** Exposed for testing: run the cleanup pass immediately. */
	async runCleanup(): Promise<number> {
		try {
			const deleted =
				await this.usersService.deleteOldGuests(GUEST_TTL_MS);
			if (deleted > 0) {
				this.logger.log(
					`Cleaned up ${deleted} expired guest account(s)`,
				);
			}
			// Also purge in-memory rate-limit records that have expired.
			this.rateLimiter.purgeExpired();
			return deleted;
		} catch (err) {
			this.logger.error("Guest cleanup failed", err);
			return 0;
		}
	}
}
