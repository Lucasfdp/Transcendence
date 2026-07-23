import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from "react";
import type { User } from "../../features/hub/api";
import { disconnectGameSocket } from "../../services/network/gameSocket";
import {
	cacheSessionUser,
	invalidateSessionCache,
	readSession,
	type SessionSnapshot,
	type SessionStatus,
} from "./sessionStore";

interface SessionContextValue extends SessionSnapshot {
	refreshSession: (force?: boolean) => Promise<SessionSnapshot>;
	invalidateSession: () => void;
	setCurrentUser: Dispatch<SetStateAction<User | null>>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
	const [session, setSession] = useState<SessionSnapshot>({
		status: "checking",
		user: null,
	});
	const [retryVersion, setRetryVersion] = useState(0);
	const retryAttempt = useRef(0);
	const retryTimer = useRef<number | null>(null);
	const mounted = useRef(true);

	const clearRetry = useCallback(() => {
		if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
		retryTimer.current = null;
		retryAttempt.current = 0;
	}, []);

	const scheduleRetry = useCallback(() => {
		if (!mounted.current || retryTimer.current !== null) return;
		const delay = Math.min(1_000 * 2 ** retryAttempt.current, 30_000);
		retryAttempt.current += 1;
		retryTimer.current = window.setTimeout(() => {
			retryTimer.current = null;
			setRetryVersion((current) => current + 1);
		}, delay);
	}, []);

	const refreshSession = useCallback(async (force = false) => {
		try {
			const nextSession = await readSession(force);
			clearRetry();
			if (mounted.current) setSession(nextSession);
			if (nextSession.status === "unauthenticated") disconnectGameSocket();
			return nextSession;
		} catch (error) {
			if (mounted.current) {
				setSession((current) =>
					current.status === "authenticated"
						? current
						: { status: "checking", user: null },
				);
			}
			scheduleRetry();
			throw error;
		}
	}, [clearRetry, scheduleRetry]);

	useEffect(() => {
		let active = true;
		void readSession(retryVersion > 0)
			.then((nextSession) => {
				if (!active) return;
				clearRetry();
				setSession(nextSession);
				if (nextSession.status === "unauthenticated") disconnectGameSocket();
			})
			.catch((error: unknown) => {
				console.warn("[SessionProvider] Session check failed:", error);
				if (!active) return;
				setSession((current) =>
					current.status === "authenticated"
						? current
						: { status: "checking", user: null },
				);
				scheduleRetry();
			});
		return () => {
			active = false;
		};
	}, [clearRetry, retryVersion, scheduleRetry]);

	useEffect(
		() => {
			mounted.current = true;
			return () => {
				mounted.current = false;
				if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
			};
		},
		[],
	);

	const invalidateSession = useCallback(() => {
		clearRetry();
		setSession(invalidateSessionCache());
		disconnectGameSocket();
	}, [clearRetry]);

	const setCurrentUser = useCallback<Dispatch<SetStateAction<User | null>>>(
		(update) => {
			setSession((current) => {
				if (current.status !== "authenticated") return current;
				const nextUser =
					typeof update === "function" ? update(current.user) : update;
				return cacheSessionUser(nextUser);
			});
		},
		[],
	);

	const value = useMemo(
		() => ({ ...session, refreshSession, invalidateSession, setCurrentUser }),
		[session, refreshSession, invalidateSession, setCurrentUser],
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
	const context = useContext(SessionContext);
	if (!context) throw new Error("useSession must be used within SessionProvider");
	return context;
}

export type { SessionStatus };
