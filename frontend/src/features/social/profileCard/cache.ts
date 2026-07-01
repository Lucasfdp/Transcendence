/**
 * Simple in-memory cache keyed by username, used to avoid re-fetching a
 * player's profile every time the hover card re-opens for the same friend
 * within a session. Not persisted — intentionally cleared on reload.
 */
export interface ProfileCardCache<T> {
	get(key: string): T | undefined;
	set(key: string, value: T): void;
	has(key: string): boolean;
}

export function createProfileCardCache<T>(): ProfileCardCache<T> {
	const store = new Map<string, T>();
	return {
		get: (key) => store.get(key),
		set: (key, value) => {
			store.set(key, value);
		},
		has: (key) => store.has(key),
	};
}
