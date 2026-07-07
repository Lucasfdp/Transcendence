/**
 * The friend code is simply the player's `@username` (usernames are unique,
 * so no separate schema/field is needed). Kept as a pure helper so the
 * formatting rule is unit-tested and reused everywhere it's displayed.
 */
export function buildFriendCode(username: string): string {
	const trimmed = username.trim();
	return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/**
 * Inverse of buildFriendCode: normalise a value typed or pasted into the
 * "Add friend" box back to a bare username. A copied friend code is formatted
 * `@username`, so without stripping the leading `@` the exact-username lookup
 * would 404 (Bug Audit M4). Only a single leading `@` is removed; usernames
 * never contain one.
 */
export function parseFriendCode(input: string): string {
	const trimmed = input.trim();
	return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}
