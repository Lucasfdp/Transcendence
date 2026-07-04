import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileCardCache } from "./cache";

describe("createProfileCardCache", () => {
	it("should return undefined for a key that was never set", () => {
		const cache = createProfileCardCache<{ name: string }>();
		expect(cache.get("kame")).toBeUndefined();
	});

	it("should return the stored value for a key that was set", () => {
		const cache = createProfileCardCache<{ name: string }>();
		cache.set("kame", { name: "Kame" });
		expect(cache.get("kame")).toEqual({ name: "Kame" });
	});

	it("should report has() as false before set and true after", () => {
		const cache = createProfileCardCache<{ name: string }>();
		expect(cache.has("kame")).toBe(false);
		cache.set("kame", { name: "Kame" });
		expect(cache.has("kame")).toBe(true);
	});

	it("should overwrite an existing value when set again with the same key", () => {
		const cache = createProfileCardCache<{ name: string }>();
		cache.set("kame", { name: "Kame" });
		cache.set("kame", { name: "KameV2" });
		expect(cache.get("kame")).toEqual({ name: "KameV2" });
	});

	it("should keep separate entries isolated between two cache instances", () => {
		const cacheA = createProfileCardCache<string>();
		const cacheB = createProfileCardCache<string>();
		cacheA.set("kame", "a");
		expect(cacheB.has("kame")).toBe(false);
	});

	// ── TTL expiry (Bug Audit L3) ────────────────────────────────────────────

	describe("TTL expiry", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should still return a value fetched well within the TTL window", () => {
			const cache = createProfileCardCache<{ level: number }>(1_000);
			cache.set("kame", { level: 5 });

			vi.advanceTimersByTime(500);

			expect(cache.get("kame")).toEqual({ level: 5 });
			expect(cache.has("kame")).toBe(true);
		});

		it("should treat an entry as gone once its TTL has elapsed", () => {
			const cache = createProfileCardCache<{ level: number }>(1_000);
			cache.set("kame", { level: 5 });

			vi.advanceTimersByTime(1_001);

			expect(cache.get("kame")).toBeUndefined();
			expect(cache.has("kame")).toBe(false);
		});

		it("should let a fresh set() after expiry start a new TTL window", () => {
			const cache = createProfileCardCache<{ level: number }>(1_000);
			cache.set("kame", { level: 5 });
			vi.advanceTimersByTime(1_001);
			expect(cache.get("kame")).toBeUndefined();

			// Simulates re-fetching after a stale hover-card miss — the friend
			// leveled up in the meantime.
			cache.set("kame", { level: 6 });
			expect(cache.get("kame")).toEqual({ level: 6 });

			vi.advanceTimersByTime(999);
			expect(cache.get("kame")).toEqual({ level: 6 });
		});

		it("should default to a sane TTL when none is provided", () => {
			const cache = createProfileCardCache<{ level: number }>();
			cache.set("kame", { level: 5 });

			// Well under the default (60s) — still cached.
			vi.advanceTimersByTime(5_000);
			expect(cache.get("kame")).toEqual({ level: 5 });
		});
	});
});
