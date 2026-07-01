/**
 * Pure, side-effect-free helpers for optimistic friend-list updates.
 *
 * Kept separate from the React layer so the list mutation logic can be unit
 * tested in isolation and reused by every social handler. None of these
 * functions mutate their inputs.
 */

export interface HasUserId {
	userId: number;
}

/** Return a new array with the entry matching `userId` removed. Never mutates. */
export function removeById<T extends HasUserId>(list: T[], userId: number): T[] {
	return list.filter((item) => item.userId !== userId);
}

/**
 * Return a new array with `item` replacing any entry of the same id; if no
 * entry matches, `item` is appended. Never mutates the input.
 */
export function upsertById<T extends HasUserId>(list: T[], item: T): T[] {
	const exists = list.some((entry) => entry.userId === item.userId);
	return exists
		? list.map((entry) => (entry.userId === item.userId ? item : entry))
		: [...list, item];
}

export interface FriendCounts {
	total: number;
	online: number;
}

/**
 * Count total friends and how many are online.
 * A null list (not yet loaded) is treated as empty.
 */
export function friendCounts(
	friends: ReadonlyArray<{ isOnline: boolean }> | null,
): FriendCounts {
	if (!friends) return { total: 0, online: 0 };
	const online = friends.reduce((n, f) => (f.isOnline ? n + 1 : n), 0);
	return { total: friends.length, online };
}
