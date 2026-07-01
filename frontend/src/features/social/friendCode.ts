/**
 * The friend code is simply the player's `@username` (usernames are unique,
 * so no separate schema/field is needed). Kept as a pure helper so the
 * formatting rule is unit-tested and reused everywhere it's displayed.
 */
export function buildFriendCode(username: string): string {
	const trimmed = username.trim();
	return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}
