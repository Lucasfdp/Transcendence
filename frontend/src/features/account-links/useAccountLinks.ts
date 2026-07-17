import { useCallback, useEffect, useRef, useState } from "react";
import { accountLinksApi } from "./accountLinksApi";
import type { AccountLinksState, AuthMethod } from "./contracts";

export function useAccountLinks(): {
	state: AccountLinksState | null;
	loading: boolean;
	error: string;
	submitting: boolean;
	conflictOpen: boolean;
	setConflictOpen: (open: boolean) => void;
	refresh: () => Promise<void>;
	createShellsmash: (data: { username: string; email: string; password: string }) => Promise<void>;
	linkShellsmash: (data: { identifier: string; password: string }) => Promise<void>;
	startOAuth: (method: Exclude<AuthMethod, "shellsmash">) => Promise<void>;
	unlink: (method: AuthMethod) => Promise<void>;
	unlinkDuplicate: (side: "current" | "linked", method: AuthMethod) => Promise<void>;
	resolve: (keep: "initiator" | "linked") => Promise<void>;
} {
	const [state, setState] = useState<AccountLinksState | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [conflictOpen, setConflictOpen] = useState(false);
	const submissionLock = useRef(false);

	const refresh = useCallback(async (): Promise<void> => {
		setError("");
		try {
			const next = await accountLinksApi.get();
			setState(next);
			if (next.conflict) setConflictOpen(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Could not load connected accounts.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const run = useCallback(
		async (operation: () => Promise<unknown>): Promise<void> => {
			if (submissionLock.current) return;
			submissionLock.current = true;
			setSubmitting(true);
			setError("");
			try {
				await operation();
				await refresh();
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : "Account link update failed.");
			} finally {
				submissionLock.current = false;
				setSubmitting(false);
			}
		},
		[refresh],
	);

	return {
		state,
		loading,
		error,
		submitting,
		conflictOpen,
		setConflictOpen,
		refresh,
		createShellsmash: (data) => run(() => accountLinksApi.createShellsmash(data)),
		linkShellsmash: (data) => run(() => accountLinksApi.linkShellsmash(data)),
		startOAuth: async (method) => {
			if (submissionLock.current) return;
			submissionLock.current = true;
			setSubmitting(true);
			setError("");
			try {
				const { url } = await accountLinksApi.startOAuth(method);
				window.location.assign(url);
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : "Could not start OAuth linking.");
				setSubmitting(false);
				submissionLock.current = false;
			}
		},
		unlink: (method) => run(() => accountLinksApi.unlink(method)),
		unlinkDuplicate: (side, method) => {
			const conflictId = state?.conflict?.id;
			return conflictId
				? run(() => accountLinksApi.unlinkDuplicate(conflictId, side, method))
				: Promise.resolve();
		},
		resolve: (keep) => {
			const conflictId = state?.conflict?.id;
			return conflictId
				? run(async () => {
						await accountLinksApi.resolve(conflictId, keep);
						window.location.replace("/?account_linked=1");
					})
				: Promise.resolve();
		},
	};
}
