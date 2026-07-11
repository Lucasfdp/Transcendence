import { describe, expect, it } from "vitest";
import type { PresenceStatus } from "../hub/api";
import {
	formatRelativeTime,
	groupFriendsByPresence,
	patchFriendPresence,
} from "./presence";

interface TestFriend {
	userId: number;
	status: PresenceStatus;
	isOnline: boolean;
	gameId: string | null;
	lastSeenAt: string | null;
}

const makeFriend = (overrides: Partial<TestFriend> = {}): TestFriend => ({
	userId: 1,
	status: "offline",
	isOnline: false,
	gameId: null,
	lastSeenAt: null,
	...overrides,
});

describe("patchFriendPresence", () => {
	const now = new Date("2026-07-11T12:00:00.000Z");

	it("patches status/isOnline/gameId for a coming-online transition", () => {
		const friends = [makeFriend({ userId: 1 }), makeFriend({ userId: 2 })];
		const result = patchFriendPresence(
			friends,
			{ userId: 2, status: "in-game", gameId: "bamboo-bash" },
			now,
		);
		expect(result[1]).toMatchObject({
			userId: 2,
			status: "in-game",
			isOnline: true,
			gameId: "bamboo-bash",
		});
		// Unaffected friend is untouched.
		expect(result[0]).toBe(friends[0]);
	});

	it("stamps lastSeenAt = now on a →offline transition", () => {
		const friends = [
			makeFriend({ userId: 1, status: "online", isOnline: true }),
		];
		const result = patchFriendPresence(
			friends,
			{ userId: 1, status: "offline", gameId: null },
			now,
		);
		expect(result[0]).toMatchObject({
			status: "offline",
			isOnline: false,
			lastSeenAt: "2026-07-11T12:00:00.000Z",
		});
	});

	it("does not stamp lastSeenAt for a non-offline transition", () => {
		const friends = [
			makeFriend({ userId: 1, lastSeenAt: "2026-01-01T00:00:00.000Z" }),
		];
		const result = patchFriendPresence(
			friends,
			{ userId: 1, status: "online", gameId: null },
			now,
		);
		expect(result[0].lastSeenAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("is a no-op returning the same array when the user isn't in the list", () => {
		const friends = [makeFriend({ userId: 1 })];
		const result = patchFriendPresence(
			friends,
			{ userId: 999, status: "online", gameId: null },
			now,
		);
		expect(result).toBe(friends);
	});

	it("never mutates the input array or its members", () => {
		const friend = makeFriend({ userId: 1, status: "online", isOnline: true });
		const friends = [friend];
		patchFriendPresence(friends, { userId: 1, status: "offline", gameId: null }, now);
		expect(friend.status).toBe("online");
		expect(friend.lastSeenAt).toBeNull();
	});
});

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
