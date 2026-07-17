/**
 * services/api/apiClient.ts — shared HTTP transport for every feature client.
 *
 * Auth is cookie-based (httpOnly auth_token set by the backend).
 * All calls use credentials: 'include' — no Authorization header, no localStorage.
 * Non-GET requests attach X-CSRF-Token from the csrf_token cookie.
 *
 * This module owns the neutral infrastructure only: base URL resolution,
 * apiFetch/apiUploadFile, CSRF discovery/caching/refresh, the transient-retry
 * policy, empty-response handling, and backend error-message parsing. Feature
 * clients (Hub, Cards, Gambling, …) must depend on this rather than
 * implementing their own fetch/CSRF/retry/upload variant.
 */

export const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

// ── Typed errors ───────────────────────────────────────────────────────────────

export class AuthError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "AuthError";
	}
}

export class NetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NetworkError";
	}
}

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRY_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

// ── CSRF token — cached in-memory after first fetchCsrfToken() call ───────────

let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
	const match = document.cookie
		.split(";")
		.find((c) => c.trim().startsWith("csrf_token="));
	return match ? match.trim().slice("csrf_token=".length) : null;
}

function getCurrentCsrfToken(): string | null {
	// Always prefer the browser cookie because it is the server-authoritative
	// token. The in-memory cache can go stale across tabs or after a later refresh.
	return readCsrfCookie() ?? cachedCsrfToken;
}

export async function fetchCsrfToken(): Promise<string> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const res = await fetch(`${API_BASE}/auth/csrf-token`, {
			credentials: "include",
		});

		if (res.ok) {
			const data = (await res.json()) as { csrfToken: string };
			cachedCsrfToken = data.csrfToken;
			return data.csrfToken;
		}

		const message = await readErrorMessage(
			res,
			`${res.status} on /auth/csrf-token`,
		);
		if (attempt === 0 && TRANSIENT_HTTP_STATUSES.has(res.status)) {
			await sleep(TRANSIENT_RETRY_DELAY_MS);
			continue;
		}

		throw new AuthError(res.status, message);
	}
	throw new AuthError(503, "Temporary auth bootstrap failure");
}

function isCsrfFailure(res: Response, message: string): boolean {
	return (
		(res.status === 401 || res.status === 403) &&
		message.toLowerCase().includes("csrf")
	);
}

function withCsrfHeader(
	headers: Record<string, string>,
	method: string,
): Record<string, string> {
	if (method === "GET" || method === "HEAD") return headers;
	const token = getCurrentCsrfToken();
	return token ? { ...headers, "X-CSRF-Token": token } : headers;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

export interface ApiFetchOptions extends RequestInit {
	/**
	 * Vouches that this endpoint is idempotent/safe to repeat, so a single
	 * bounded retry on a transient 5xx (502/503/504) is allowed for non-GET
	 * methods too — the same treatment GET already gets (Bug Audit L1).
	 *
	 * Only set this for state-scoped mutations that no-op when already
	 * applied — see the Hub client's `acceptFriendRequest`,
	 * `declineOrCancelFriendRequest`, `removeFriend`, `blockUser`, and
	 * `markConversationReadRest`. Do NOT set this for side-effecting actions
	 * like casino spins, chat sends, or match-result submission: a transient
	 * 5xx there can't be distinguished from "the backend already processed
	 * this and the response was lost in transit", so retrying risks
	 * double-spending coins or double-counting a match result.
	 */
	idempotent?: boolean;
}

export async function apiFetch<T>(
	path: string,
	{ idempotent, ...options }: ApiFetchOptions = {},
): Promise<T> {
	const method = (options.method ?? "GET").toUpperCase();
	const baseHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.headers as Record<string, string>),
	};
	// GET is always safe to retry; non-GET only retries when the caller has
	// explicitly opted in via `idempotent: true`.
	const retryableOnTransient = method === "GET" || idempotent === true;

	const runFetch = () =>
		fetch(`${API_BASE}${path}`, {
			...options,
			headers: withCsrfHeader(baseHeaders, method),
			credentials: "include",
		});

	let res: Response;
	try {
		res = await runFetch();
	} catch (err) {
		throw new NetworkError(
			`Network request failed for ${path}: ${String(err)}`,
		);
	}

	if (!res.ok) {
		const message = await readErrorMessage(res, `${res.status} on ${path}`);
		if (TRANSIENT_HTTP_STATUSES.has(res.status) && retryableOnTransient) {
			await sleep(TRANSIENT_RETRY_DELAY_MS);
			try {
				res = await runFetch();
			} catch (err) {
				throw new NetworkError(
					`Network request failed for ${path}: ${String(err)}`,
				);
			}
			if (!res.ok) {
				throw new AuthError(
					res.status,
					await readErrorMessage(res, `${res.status} on ${path}`),
				);
			}
		} else if (
			isCsrfFailure(res, message) &&
			method !== "GET" &&
			method !== "HEAD"
		) {
			await fetchCsrfToken();
			try {
				res = await runFetch();
			} catch (err) {
				throw new NetworkError(
					`Network request failed for ${path}: ${String(err)}`,
				);
			}
			if (!res.ok) {
				throw new AuthError(
					res.status,
					await readErrorMessage(res, `${res.status} on ${path}`),
				);
			}
		} else {
			throw new AuthError(res.status, message);
		}
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

export async function apiUploadFile<T>(
	path: string,
	formData: FormData,
): Promise<T> {
	const headers = withCsrfHeader({}, "POST");
	let res: Response;
	try {
		res = await fetch(`${API_BASE}${path}`, {
			method: "POST",
			headers,
			credentials: "include",
			body: formData,
		});
	} catch (err) {
		throw new NetworkError(
			`Network request failed for ${path}: ${String(err)}`,
		);
	}
	if (!res.ok) {
		const message = await readErrorMessage(res, `${res.status} on ${path}`);
		if (isCsrfFailure(res, message)) {
			await fetchCsrfToken();
			res = await fetch(`${API_BASE}${path}`, {
				method: "POST",
				headers: withCsrfHeader({}, "POST"),
				credentials: "include",
				body: formData,
			});
			if (!res.ok) {
				throw new AuthError(
					res.status,
					await readErrorMessage(res, `${res.status} on ${path}`),
				);
			}
		} else {
			throw new AuthError(res.status, message);
		}
	}
	// Mirror apiFetch's empty-body guard (Bug Audit L2): works today because
	// avatar upload always returns JSON, but any future empty-body upload
	// response (e.g. a 204) would otherwise throw a JSON parse error here.
	if (res.status === 204) return {} as T;
	return res.json() as Promise<T>;
}

export async function readErrorMessage(
	res: Response,
	fallback: string,
): Promise<string> {
	const contentType = res.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		try {
			const body = (await res.json()) as {
				message?: string | string[];
				error?: string;
			};
			if (Array.isArray(body.message) && body.message.length > 0) {
				return body.message.join(", ");
			}
			if (typeof body.message === "string" && body.message.trim()) {
				return body.message;
			}
			if (typeof body.error === "string" && body.error.trim()) {
				return body.error;
			}
		} catch {
			return fallback;
		}
	}

	try {
		const text = await res.text();
		return text.trim() || fallback;
	} catch {
		return fallback;
	}
}
