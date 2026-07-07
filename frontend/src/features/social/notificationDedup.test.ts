import { describe, expect, it } from "vitest";
import {
	notificationIdsFrom,
	prependNotificationDeduped,
	removeNotificationsFrom,
} from "./notificationDedup";

interface Notif {
	id: number;
	type: string;
	fromUserId: number;
}

const notif = (overrides: Partial<Notif>): Notif => ({
	id: 1,
	type: "friend_request",
	fromUserId: 10,
	...overrides,
});

describe("notificationIdsFrom", () => {
	it("should return the ids of all notifications matching fromUserId and type", () => {
		const notifications = [
			notif({ id: 1, fromUserId: 10, type: "friend_request" }),
			notif({ id: 2, fromUserId: 10, type: "friend_request" }),
			notif({ id: 3, fromUserId: 20, type: "friend_request" }),
		];
		expect(notificationIdsFrom(notifications, 10, "friend_request")).toEqual([
			1, 2,
		]);
	});

	it("should not match notifications of a different type from the same user", () => {
		const notifications = [
			notif({ id: 1, fromUserId: 10, type: "friend_accepted" }),
		];
		expect(notificationIdsFrom(notifications, 10, "friend_request")).toEqual(
			[],
		);
	});

	it("should return an empty array when nothing matches", () => {
		expect(notificationIdsFrom([], 10, "friend_request")).toEqual([]);
	});
});

describe("removeNotificationsFrom", () => {
	it("should drop every notification matching fromUserId and type (deduping duplicates)", () => {
		const notifications = [
			notif({ id: 1, fromUserId: 10, type: "friend_request" }),
			notif({ id: 2, fromUserId: 10, type: "friend_request" }),
			notif({ id: 3, fromUserId: 20, type: "friend_request" }),
		];
		expect(removeNotificationsFrom(notifications, 10, "friend_request")).toEqual([
			notif({ id: 3, fromUserId: 20, type: "friend_request" }),
		]);
	});

	it("should not mutate the input array", () => {
		const notifications = [
			notif({ id: 1, fromUserId: 10, type: "friend_request" }),
		];
		const original = [...notifications];
		removeNotificationsFrom(notifications, 10, "friend_request");
		expect(notifications).toEqual(original);
	});

	it("should return the same-shaped empty array when the list is already empty", () => {
		expect(removeNotificationsFrom([], 10, "friend_request")).toEqual([]);
	});
});

describe("prependNotificationDeduped", () => {
	it("should prepend a new item when its id isn't already present", () => {
		const notifications = [notif({ id: 1 })];
		const result = prependNotificationDeduped(notifications, notif({ id: 2 }));
		expect(result).toEqual([notif({ id: 2 }), notif({ id: 1 })]);
	});

	it("should not add a duplicate when the id is already present (Bug Audit L4)", () => {
		const notifications = [notif({ id: 1 }), notif({ id: 2 })];
		const result = prependNotificationDeduped(notifications, notif({ id: 1 }));
		expect(result).toEqual(notifications);
		expect(result).toHaveLength(2);
	});

	it("should not mutate the input array", () => {
		const notifications = [notif({ id: 1 })];
		const original = [...notifications];
		prependNotificationDeduped(notifications, notif({ id: 2 }));
		expect(notifications).toEqual(original);
	});

	it("should prepend into an empty list", () => {
		expect(prependNotificationDeduped([], notif({ id: 1 }))).toEqual([
			notif({ id: 1 }),
		]);
	});
});
