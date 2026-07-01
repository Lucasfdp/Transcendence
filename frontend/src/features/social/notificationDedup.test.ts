import { describe, expect, it } from "vitest";
import {
	notificationIdsFrom,
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
