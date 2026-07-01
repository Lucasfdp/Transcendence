/**
 * Pure search/filter for the friends list. Matches on username or turtleName,
 * case-insensitively, as a substring. Kept separate from the React layer so
 * the matching rule is unit-tested in isolation.
 */

export interface HasSearchableName {
	username: string;
	turtleName: string | null;
}

export function filterFriends<T extends HasSearchableName>(
	friends: ReadonlyArray<T>,
	query: string,
): T[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return [...friends];

	return friends.filter((friend) => {
		const username = friend.username.toLowerCase();
		const turtleName = friend.turtleName?.toLowerCase() ?? "";
		return username.includes(trimmed) || turtleName.includes(trimmed);
	});
}
