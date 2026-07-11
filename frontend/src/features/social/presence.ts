/**
 * Pure helpers for rendering friend presence — relative "last online" times and
 * grouping a friend list by presence status. UI-agnostic and side-effect free so
 * they can be unit tested directly.
 */
import type { PresenceStatus } from "../hub/api";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format an ISO timestamp as a coarse relative time ("just now", "15m ago",
 * "3h ago", "2d ago"). Returns "a while ago" when the timestamp is unknown.
 */
export function formatRelativeTime(
	iso: string | null,
	now: Date = new Date(),
): string {
	if (!iso) return "a while ago";
	const diff = now.getTime() - new Date(iso).getTime();
	if (diff < MS_PER_MINUTE) return "just now";
	if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
	if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
	return `${Math.floor(diff / MS_PER_DAY)}d ago`;
}

/** Payload of a live `presence:changed` event (Decision 3). */
export interface PresenceChange {
	userId: number;
	status: PresenceStatus;
	gameId: string | null;
}

/**
 * Apply a live `presence:changed` event to a friend list (Decision 3).
 * Returns a new array with the matching friend's status/isOnline/gameId
 * patched, stamping `lastSeenAt = now` on a →offline transition. A no-op
 * (returns the input array unchanged) when the user isn't in the list — e.g.
 * a presence event that races the initial getFriends() fetch. Never mutates
 * its input.
 */
export function patchFriendPresence<
	T extends {
		userId: number;
		status: PresenceStatus;
		isOnline: boolean;
		gameId: string | null;
		lastSeenAt: string | null;
	},
>(friends: T[], change: PresenceChange, now: Date = new Date()): T[] {
	if (!friends.some((f) => f.userId === change.userId)) return friends;
	return friends.map((f) =>
		f.userId === change.userId
			? {
					...f,
					status: change.status,
					isOnline: change.status !== "offline",
					gameId: change.gameId,
					lastSeenAt:
						change.status === "offline" ? now.toISOString() : f.lastSeenAt,
				}
			: f,
	);
}

export interface PresenceGroups<T> {
	inGame: T[];
	online: T[];
	offline: T[];
}

/**
 * Partition friends into in-game / online / offline buckets, preserving the
 * original order within each bucket.
 */
export function groupFriendsByPresence<T extends { status: PresenceStatus }>(
	friends: T[],
): PresenceGroups<T> {
	const groups: PresenceGroups<T> = { inGame: [], online: [], offline: [] };
	for (const friend of friends) {
		if (friend.status === "in-game") groups.inGame.push(friend);
		else if (friend.status === "online") groups.online.push(friend);
		else groups.offline.push(friend);
	}
	return groups;
}
