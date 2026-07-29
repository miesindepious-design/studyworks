/**
 * useSession — loads and caches the current server session.
 * Returns null when not authenticated, the user object when signed in.
 * Components use this to conditionally render the app or the auth screen.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSession } from '../api/auth';
import type { AuthUser } from '../api/auth';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface UseSessionResult {
  user:    AuthUser | null;
  status:  SessionStatus;
  refresh: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}

export function useSession(): UseSessionResult {
  const [user,   setUserState] = useState<AuthUser | null>(null);
  const [status, setStatus]    = useState<SessionStatus>('loading');

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const session = await getSession();
      if (session?.user) {
        setUser(session.user);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // setUser must keep `status` in sync so the auth gate (App.tsx) flips to the
  // sign-in screen on sign-out (user -> null => unauthenticated) and to the
  // dashboard on sign-in (user -> object => authenticated).
  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    setStatus(u ? 'authenticated' : 'unauthenticated');
  }, []);

  return { user, status, refresh, setUser };
}
