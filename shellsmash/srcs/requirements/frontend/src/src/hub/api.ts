/**
 * hub/api.ts — typed REST client for the Shell Smash backend.
 *
 * Auth is cookie-based (httpOnly auth_token set by the backend).
 * All calls use credentials: 'include' — no Authorization header, no localStorage.
 * Non-GET requests attach X-CSRF-Token from the csrf_token cookie.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── Typed errors ───────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ── CSRF token — cached in-memory after first getCsrfToken() call ─────────────

let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
  const match = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith('csrf_token='));
  return match ? match.trim().slice('csrf_token='.length) : null;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method  = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    const token = cachedCsrfToken ?? readCsrfCookie();
    if (token) headers['X-CSRF-Token'] = token;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    throw new NetworkError(`Network request failed for ${path}: ${String(err)}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(res.status, `${res.status} on ${path}`);
  }
  if (!res.ok) {
    throw new NetworkError(`API error ${res.status} on ${path}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface User {
  id:           number;
  username:     string;
  turtleName:   string | null;
  shellSkin:    string;
  level:        number;
  xp:           number;
  coins:        number;
  isGuest:      boolean;
  isDevAccount: boolean;
  avatar:       string | null;
  profile?: {
    totalWins:   number;
    totalLosses: number;
    gamesPlayed: number;
    bio:         string | null;
  };
}

export interface ProgressionResult {
  xpGained:    number;
  coinsGained: number;
  newXp:       number;
  newLevel:    number;
  newCoins:    number;
  leveledUp:   boolean;
}

export interface MiniGameDefinition {
  id:          string;
  name:        string;
  status:      'available' | 'locked' | 'coming_soon';
  description: string;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
  /** Fetch and cache the CSRF token. Call once before any POST/DELETE. */
  getCsrfToken: async (): Promise<string> => {
    const data = await apiFetch<{ csrfToken: string }>('/auth/csrf-token');
    cachedCsrfToken = data.csrfToken;
    return data.csrfToken;
  },

  /** Returns the current user or throws AuthError(401) if no session. */
  getMe: (): Promise<User> => apiFetch<User>('/auth/me'),

  /** URL to redirect to in order to start the 42 OAuth flow. */
  loginUrl: (): string => `${API_BASE}/auth/42`,

  /** Create a guest session (httpOnly cookie, 2-hour TTL). */
  guestLogin: (): Promise<{ ok: boolean }> =>
    apiFetch<{ ok: boolean }>('/auth/guest', { method: 'POST' }),

  /** Create a new local account and log in. Sets httpOnly auth cookie. */
  register: (username: string, password: string): Promise<{ ok: boolean }> =>
    apiFetch<{ ok: boolean }>('/auth/register', {
      method: 'POST',
      body:   JSON.stringify({ username, password }),
    }),

  /** Log in to an existing local account. Sets httpOnly auth cookie. */
  login: (username: string, password: string): Promise<{ ok: boolean }> =>
    apiFetch<{ ok: boolean }>('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ username, password }),
    }),

  /** Dev-only — requires ENABLE_DEV_LOGIN=true on the backend. */
  devLogin: (username = 'KameMaster'): Promise<{ ok: boolean }> =>
    apiFetch<{ ok: boolean }>(
      `/auth/dev-login?username=${encodeURIComponent(username)}`,
    ),

  /** Logout — clears the auth cookie. */
  logout: (): Promise<{ ok: boolean }> =>
    apiFetch<{ ok: boolean }>('/auth/session', { method: 'DELETE' }),

  getUser:      (username: string): Promise<User>        => apiFetch<User>(`/users/${username}`),
  getAllUsers:   (): Promise<User[]>                      => apiFetch<User[]>('/users'),
  getMiniGames: (): Promise<MiniGameDefinition[]>        => apiFetch<MiniGameDefinition[]>('/minigames'),

  /**
   * Record the outcome of a completed game session.
   * Returns XP / coin / level-up deltas for progression feedback animation.
   * Non-fatal on failure — callers should catch and log, then continue.
   */
  submitGameResult: (
    gameId:  string,
    outcome: 'win' | 'loss',
  ): Promise<ProgressionResult> =>
    apiFetch<ProgressionResult>('/game-results', {
      method: 'POST',
      body:   JSON.stringify({ gameId, outcome }),
    }),
};
