import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSession, type SessionStatus } from "../app/session/SessionContext";
import { isSessionFresh } from "../app/session/sessionStore";

export function useSessionGate(): { status: SessionStatus } {
	const location = useLocation();
	const { status, refreshSession } = useSession();
	const [validation, setValidation] = useState(() => ({
		path: location.pathname,
		pending: !isSessionFresh(),
	}));
	const validating =
		validation.path === location.pathname
			? validation.pending
			: !isSessionFresh();

	useEffect(() => {
		let active = true;
		if (!isSessionFresh()) {
			setValidation({ path: location.pathname, pending: true });
		}
		void refreshSession()
			.catch(() => undefined)
			.finally(() => {
				if (active) {
					setValidation({ path: location.pathname, pending: false });
				}
			});
		return () => {
			active = false;
		};
	}, [location.pathname, refreshSession]);

	return { status: validating ? "checking" : status };
}
