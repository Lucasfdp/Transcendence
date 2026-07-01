import { describe, expect, it } from "vitest";
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
});
