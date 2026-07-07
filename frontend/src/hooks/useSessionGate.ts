import { useEffect, useState } from "react";
import { api, AuthError } from "../features/hub/api";
import { disconnectGameSocket } from "../services/network/gameSocket";

export type SessionStatus = "checking" | "authenticated" | "unauthenticated";

export function useSessionGate(): { status: SessionStatus } {
	const [status, setStatus] = useState<SessionStatus>("checking");

	useEffect(() => {
		let cancelled = false;

		void api
			.getMe()
			.then(() => {
				if (!cancelled) {
					setStatus("authenticated");
				}
			})
			.catch((err: unknown) => {
				if (cancelled) return;

				// Bug Audit H2: any path that lands here means ProtectedRoute is
				// about to redirect to /auth. Drop the shared game socket too —
				// otherwise a session invalidated server-side (revoked token,
				// expired cookie) leaves a stale authenticated socket connected,
				// which the next SPA login on this tab would silently inherit.
				disconnectGameSocket();

				if (err instanceof AuthError) {
					setStatus("unauthenticated");
					return;
				}

				console.warn("[useSessionGate] Session check failed:", err);
				setStatus("unauthenticated");
			});

		return () => {
			cancelled = true;
		};
	}, []);

	return { status };
}
