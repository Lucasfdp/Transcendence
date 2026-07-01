import { describe, expect, it } from "vitest";
import { friendCounts, removeById, upsertById } from "./friendsOps";

describe("removeById", () => {
	it("should remove the entry with the matching userId", () => {
		const list = [{ userId: 1 }, { userId: 2 }];
		expect(removeById(list, 1)).toEqual([{ userId: 2 }]);
	});

	it("should return an equivalent list when no id matches", () => {
		expect(removeById([{ userId: 1 }], 99)).toEqual([{ userId: 1 }]);
	});

	it("should not mutate the original array", () => {
		const list = [{ userId: 1 }, { userId: 2 }];
		removeById(list, 1);
		expect(list).toHaveLength(2);
	});
});

describe("upsertById", () => {
	it("should append when the id is not present", () => {
		expect(upsertById([{ userId: 1 }], { userId: 2 })).toEqual([
			{ userId: 1 },
			{ userId: 2 },
		]);
	});

	it("should replace the existing entry when the id matches", () => {
		expect(upsertById([{ userId: 1, v: "a" }], { userId: 1, v: "b" })).toEqual([
			{ userId: 1, v: "b" },
		]);
	});

	it("should not mutate the original array", () => {
		const list = [{ userId: 1 }];
		upsertById(list, { userId: 2 });
		expect(list).toHaveLength(1);
	});
});

describe("friendCounts", () => {
	it("should return zeroes for an empty list", () => {
		expect(friendCounts([])).toEqual({ total: 0, online: 0 });
	});

	it("should return zeroes for null (not yet loaded)", () => {
		expect(friendCounts(null)).toEqual({ total: 0, online: 0 });
	});

	it("should count total and online separately", () => {
		expect(
			friendCounts([
				{ isOnline: true },
				{ isOnline: false },
				{ isOnline: true },
			]),
		).toEqual({ total: 3, online: 2 });
	});
});
