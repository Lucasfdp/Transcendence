const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function getToken(): string | null {
  return localStorage.getItem('jwt_token');
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.json();
}

export interface MiniGameDefinition {
  id: string;
  name: string;
  status: 'available' | 'locked' | 'coming_soon';
  description: string;
}

export const api = {
  getMe: () => apiFetch('/auth/me'),
  getUser: (username: string) => apiFetch(`/users/${username}`),
  getAllUsers: () => apiFetch('/users'),
  getMiniGames: (): Promise<MiniGameDefinition[]> => apiFetch('/minigames'),
  loginUrl: () => `${API_BASE}/auth/42`,

  /** Dev-only: get a JWT without OAuth. Stores token in localStorage. */
  devLogin: async (username = 'KameMaster'): Promise<void> => {
    const data = await apiFetch(`/auth/dev-login?username=${encodeURIComponent(username)}`);
    localStorage.setItem('jwt_token', data.access_token);
  },
};
