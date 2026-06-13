import { Injectable } from '@nestjs/common';
import { Request } from 'express';

interface RateLimitRecord {
  count:     number;
  windowEnd: number;  // epoch ms when the current window expires
}

/**
 * Simple in-memory per-IP rate limiter.
 * Replaces @nestjs/throttler which cannot be installed in this environment.
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
  allow(req: Request, bucket: string, max: number, windowMs: number): boolean {
    const ip  = this.getIp(req);
    const key = `${bucket}:${ip}`;
    const now = Date.now();

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
    // Respect X-Forwarded-For set by the Nginx reverse proxy.
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress ?? 'unknown';
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
