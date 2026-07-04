/**
 * Simple in-memory cache keyed by username, used to avoid re-fetching a
 * player's profile every time the hover card re-opens for the same friend
 * within a session. Not persisted — intentionally cleared on reload.
 *
 * Entries expire after `ttlMs` (Bug Audit L3): without a TTL, a friend who
 * levels up, changes their avatar, or updates their tag mid-session would
 * keep showing stale data in the hover card for the rest of the session,
 * since nothing ever invalidated the cached entry. A short TTL bounds the
 * staleness window without needing a live "profile updated" event feed.
 */
export interface ProfileCardCache<T> {
	get(key: string): T | undefined;
	set(key: string, value: T): void;
	has(key: string): boolean;
}

/** Default staleness window for a cached hover-card profile. */
export const PROFILE_CARD_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export function createProfileCardCache<T>(
	ttlMs: number = PROFILE_CARD_CACHE_TTL_MS,
): ProfileCardCache<T> {
	const store = new Map<string, CacheEntry<T>>();

	/** Returns the live entry for `key`, evicting it first if it has expired. */
	const liveEntry = (key: string): CacheEntry<T> | undefined => {
		const entry = store.get(key);
		if (!entry) return undefined;
		if (Date.now() >= entry.expiresAt) {
			store.delete(key);
			return undefined;
		}
		return entry;
	};

	return {
		get: (key) => liveEntry(key)?.value,
		set: (key, value) => {
			store.set(key, { value, expiresAt: Date.now() + ttlMs });
		},
		has: (key) => liveEntry(key) !== undefined,
	};
}
