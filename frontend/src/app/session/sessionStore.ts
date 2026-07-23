import { api, AuthError, type User } from "../../features/hub/api";

export type SessionStatus = "checking" | "authenticated" | "unauthenticated";

export interface SessionSnapshot {
	status: SessionStatus;
	user: User | null;
}

const SESSION_FRESHNESS_MS = 30_000;

let snapshot: SessionSnapshot = { status: "checking", user: null };
let resolvedAt = 0;
let inFlight: {
	generation: number;
	promise: Promise<SessionSnapshot>;
} | null = null;
let generation = 0;
let explicitlyInvalidated = false;

export function readSession(force = false): Promise<SessionSnapshot> {
	if (inFlight?.generation === generation) return inFlight.promise;
	if (explicitlyInvalidated && !force) return Promise.resolve(snapshot);
	if (
		!force &&
		snapshot.status !== "checking" &&
		Date.now() - resolvedAt < SESSION_FRESHNESS_MS
	) {
		return Promise.resolve(snapshot);
	}

	const requestGeneration = generation;
	const promise = api
		.getMe()
		.then((user) => {
			if (requestGeneration !== generation) return snapshot;
			explicitlyInvalidated = false;
			snapshot = { status: "authenticated", user };
			resolvedAt = Date.now();
			return snapshot;
		})
		.catch((error: unknown) => {
			if (requestGeneration !== generation) return snapshot;
			if (error instanceof AuthError && error.status === 401) {
				snapshot = { status: "unauthenticated", user: null };
				resolvedAt = Date.now();
				return snapshot;
			}
			throw error;
		})
		.finally(() => {
			if (inFlight?.promise === promise) inFlight = null;
		});
	inFlight = { generation: requestGeneration, promise };
	return promise;
}

export function isSessionFresh(): boolean {
	return (
		snapshot.status !== "checking" &&
		Date.now() - resolvedAt < SESSION_FRESHNESS_MS
	);
}

export function cacheSessionUser(user: User | null): SessionSnapshot {
	if (!user) return invalidateSessionCache();
	explicitlyInvalidated = false;
	snapshot = { status: "authenticated", user };
	resolvedAt = Date.now();
	return snapshot;
}

export function invalidateSessionCache(): SessionSnapshot {
	generation += 1;
	explicitlyInvalidated = true;
	snapshot = { status: "unauthenticated", user: null };
	resolvedAt = Date.now();
	return snapshot;
}

export function resetSessionStore(): void {
	generation += 1;
	explicitlyInvalidated = false;
	snapshot = { status: "checking", user: null };
	resolvedAt = 0;
	inFlight = null;
}
