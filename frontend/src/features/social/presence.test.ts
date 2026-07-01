import { describe, expect, it } from "vitest";
import type { PresenceStatus } from "../hub/api";
import { formatRelativeTime, groupFriendsByPresence } from "./presence";

describe("formatRelativeTime", () => {
	const now = new Date("2026-07-01T12:00:00.000Z");

	it("should return 'a while ago' when the timestamp is null", () => {
		expect(formatRelativeTime(null, now)).toBe("a while ago");
	});

	it("should return 'just now' for under a minute", () => {
		expect(formatRelativeTime("2026-07-01T11:59:30.000Z", now)).toBe(
			"just now",
		);
	});

	it("should return minutes for under an hour", () => {
		expect(formatRelativeTime("2026-07-01T11:45:00.000Z", now)).toBe(
			"15m ago",
		);
	});

	it("should return hours for under a day", () => {
		expect(formatRelativeTime("2026-07-01T09:00:00.000Z", now)).toBe(
			"3h ago",
		);
	});

	it("should return days for a day or more", () => {
		expect(formatRelativeTime("2026-06-29T12:00:00.000Z", now)).toBe(
			"2d ago",
		);
	});
});

describe("groupFriendsByPresence", () => {
	const f = (userId: number, status: PresenceStatus) => ({ userId, status });

	it("should split friends into inGame, online and offline preserving order", () => {
		const friends = [
			f(1, "online"),
			f(2, "in-game"),
			f(3, "offline"),
			f(4, "online"),
		];
		const groups = groupFriendsByPresence(friends);
		expect(groups.inGame.map((x) => x.userId)).toEqual([2]);
		expect(groups.online.map((x) => x.userId)).toEqual([1, 4]);
		expect(groups.offline.map((x) => x.userId)).toEqual([3]);
	});

	it("should return empty arrays for an empty input", () => {
		expect(groupFriendsByPresence([])).toEqual({
			inGame: [],
			online: [],
			offline: [],
		});
	});
});
