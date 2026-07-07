/**
 * Pure helpers for reconciling duplicate notifications client-side.
 *
 * Bug this fixes: if a user receives two "friend_request" notifications from
 * the same sender (e.g. a retried request), acting on either one (accept or
 * decline) must resolve *both* — otherwise accepting one then declining the
 * duplicate nets to added-then-removed friendship state. See
 * NotificationsService.create for the matching backend-side dedup that stops
 * new duplicates from being persisted going forward; this covers any
 * duplicates that already exist in a client's current inbox.
 */

export interface HasNotificationShape {
	id: number;
	type: string;
	fromUserId: number;
}

/** Return the ids of every notification matching `fromUserId` and `type`. */
export function notificationIdsFrom<T extends HasNotificationShape>(
	notifications: ReadonlyArray<T>,
	fromUserId: number,
	type: string,
): number[] {
	return notifications
		.filter((n) => n.fromUserId === fromUserId && n.type === type)
		.map((n) => n.id);
}

/**
 * Return a new array with every notification matching `fromUserId` and
 * `type` removed. Never mutates the input.
 */
export function removeNotificationsFrom<T extends HasNotificationShape>(
	notifications: ReadonlyArray<T>,
	fromUserId: number,
	type: string,
): T[] {
	return notifications.filter(
		(n) => !(n.fromUserId === fromUserId && n.type === type),
	);
}

/**
 * Prepend a freshly-pushed `notification:new` item, unless a notification
 * with the same id is already present. Without this, a duplicated push (e.g.
 * a reconnect race re-delivering the same row) would render the item twice
 * and produce duplicate React keys (Bug Audit L4). Never mutates the input.
 */
export function prependNotificationDeduped<T extends HasNotificationShape>(
	notifications: ReadonlyArray<T>,
	item: T,
): T[] {
	if (notifications.some((n) => n.id === item.id)) {
		return [...notifications];
	}
	return [item, ...notifications];
}
