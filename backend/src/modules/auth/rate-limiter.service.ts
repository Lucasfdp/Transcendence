import { Injectable } from "@nestjs/common";
import { Request } from "express";

interface RateLimitRecord {
	count: number;
	windowEnd: number; // epoch ms when the current window expires
}

/**
 * Simple in-memory per-IP rate limiter.
 * Replaces @nestjs/throttler which cannot be installed in this environment.
 *
 * **Single-process only.** This service stores state in a plain Map and does
 * not synchronise across replicas.  In a multi-replica deployment each pod
 * maintains an independent window, so the effective limit is `max × replicas`.
 * Replace with a Redis-backed solution (e.g. sliding-window Lua script) before
 * scaling horizontally.
 *
 * Usage:
 *   if (!this.rateLimiter.allow(req, 'guest', 10, 60_000)) throw new TooManyRequestsException();
 */
@Injectable()
export class RateLimiterService {
	private readonly store = new Map<string, RateLimitRecord>();

	/**
	 * @param req      - Express request (used to extract the client IP)
	 * @param bucket   - Logical bucket name (allows different limits per endpoint)
	 * @param max      - Maximum requests allowed within `windowMs`
	 * @param windowMs - Window duration in milliseconds
	 * @returns true if the request is within the limit; false if it should be blocked
	 */
	allow(
		req: Request,
		bucket: string,
		max: number,
		windowMs: number,
	): boolean {
		return this.consume(`${bucket}:${this.getIp(req)}`, max, windowMs);
	}

	/**
	 * Rate-limit by an arbitrary identity instead of the request IP — for
	 * non-HTTP call sites (WebSocket handlers, where there is no Express
	 * request) or per-user limits where the authenticated user id is a better
	 * key than a shared egress IP (Bug Audit M7).
	 *
	 * @param bucket   - Logical bucket name (allows different limits per action)
	 * @param identity - Stable per-caller identity (e.g. `String(userId)`)
	 * @param max      - Maximum requests allowed within `windowMs`
	 * @param windowMs - Window duration in milliseconds
	 */
	allowKey(
		bucket: string,
		identity: string,
		max: number,
		windowMs: number,
	): boolean {
		return this.consume(`${bucket}:${identity}`, max, windowMs);
	}

	private consume(key: string, max: number, windowMs: number): boolean {
		const now = Date.now();

		// Purge on every call so the Map cannot grow unboundedly between
		// the hourly GuestCleanupService sweep.
		this.purgeExpired();

		let record = this.store.get(key);
		if (!record || now > record.windowEnd) {
			record = { count: 1, windowEnd: now + windowMs };
			this.store.set(key, record);
			return true;
		}
		record.count += 1;
		return record.count <= max;
	}

	private getIp(req: Request): string {
		// Do NOT parse X-Forwarded-For manually: nginx appends the real
		// client IP via `$proxy_add_x_forwarded_for`, but the left-most
		// token is fully attacker-controlled (a client can send its own
		// `X-Forwarded-For` header). Reading `forwarded.split(",")[0]`
		// lets an attacker rotate a fake first token per request and
		// bypass the limiter entirely (Bug Audit C1).
		//
		// `app.set("trust proxy", 1)` in main.ts tells Express to trust
		// exactly one hop (the nginx reverse proxy) and derive `req.ip`
		// from the right-most XFF entry it appended, which reflects the
		// real socket peer nginx saw and cannot be spoofed by the client.
		return req.ip ?? req.socket?.remoteAddress ?? "unknown";
	}

	/**
	 * Periodically purge expired records to prevent unbounded memory growth.
	 * Call this on a timer or let it be called lazily — it's safe to skip.
	 */
	purgeExpired(): void {
		const now = Date.now();
		for (const [key, record] of this.store) {
			if (now > record.windowEnd) this.store.delete(key);
		}
	}
}
