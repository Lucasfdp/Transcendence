import { apiFetch } from "../../services/api/apiClient";
import type { AccountLinksState, AuthMethod } from "./contracts";

export const accountLinksApi = {
	get: (): Promise<AccountLinksState> =>
		apiFetch<AccountLinksState>("/auth/account-links"),
	createShellsmash: (data: {
		username: string;
		email: string;
		password: string;
	}): Promise<{ ok: true }> =>
		apiFetch("/auth/account-links/shellsmash/create", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	linkShellsmash: (data: {
		identifier: string;
		password: string;
	}): Promise<{ ok: true; conflict: boolean }> =>
		apiFetch("/auth/account-links/shellsmash/link", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	startOAuth: (method: Exclude<AuthMethod, "shellsmash">): Promise<{ url: string }> =>
		apiFetch(`/auth/account-links/${method}/start`, { method: "POST" }),
	unlink: (method: AuthMethod): Promise<{ ok: true }> =>
		apiFetch(`/auth/account-links/${method}`, {
			method: "DELETE",
			idempotent: true,
		}),
	unlinkDuplicate: (
		conflictId: string,
		side: "current" | "linked",
		method: AuthMethod,
	): Promise<{ ok: true }> =>
		apiFetch(
			`/auth/account-link-conflict/${conflictId}/${side}/${method}`,
			{ method: "DELETE", idempotent: true },
		),
	resolve: (
		conflictId: string,
		keep: "initiator" | "linked",
	): Promise<{ ok: true; userId: number }> =>
		apiFetch("/auth/account-link-conflict/resolve", {
			method: "POST",
			body: JSON.stringify({ conflictId, keep }),
		}),
};
