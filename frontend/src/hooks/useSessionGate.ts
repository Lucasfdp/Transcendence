import { useEffect, useState } from 'react';
import { api, AuthError } from '../features/hub/api';

export type SessionStatus = 'checking' | 'authenticated' | 'unauthenticated';

export function useSessionGate(): { status: SessionStatus } {
  const [status, setStatus] = useState<SessionStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    void api.getMe()
      .then(() => {
        if (!cancelled) {
          setStatus('authenticated');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        if (err instanceof AuthError) {
          setStatus('unauthenticated');
          return;
        }

        console.warn('[useSessionGate] Session check failed:', err);
        setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { status };
}
