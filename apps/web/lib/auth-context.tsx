'use client';

/**
 * Auth context for the web app.
 *
 * Design:
 *   - Access tokens (15-min JWTs) live only in React state. They never touch
 *     localStorage — so a stolen cookie alone can't mint new tokens, and an
 *     XSS can't exfiltrate a long-lived credential.
 *   - Refresh tokens are opaque 30-day values set by the API as an httpOnly
 *     cookie scoped to /api/auth. They come along automatically on /refresh
 *     and /logout thanks to `credentials: 'include'` in the api() helper.
 *   - On mount, we silently attempt POST /api/auth/refresh. If it returns a
 *     session the user was already logged in; otherwise they're anonymous.
 *   - Before the access token expires we refresh again. The timer is set to
 *     fire a bit before the actual expiry so we don't race the clock.
 *
 * The provider is intentionally lightweight — no SWR, no Tanstack Query, no
 * persistence layer. It's easy to wrap in those later if we need it, but for
 * an MVP a bit of state and a few functions is enough.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, ApiError } from './api';

/** Matches @porch/types/api SessionResponse — duplicated here to keep the web
 * package's client bundle from pulling in the full types package. */
export interface SessionAccount {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface SessionPersona {
  id: string;
  username: string;
  displayName: string;
  did: string;
}

export interface SessionResponse {
  account: SessionAccount;
  persona: SessionPersona;
  session: {
    accessToken: string;
    expiresAt: string;
  };
}

export interface SignupInput {
  email: string;
  password: string;
  username: string;
  displayName: string;
  ageAttestation: { isAdult: true; jurisdiction: string };
}

export interface LoginInput {
  email: string;
  password: string;
}

interface AuthState {
  /** `undefined` while we're doing the initial refresh probe; after that it
   * settles to either a session object or `null` for anonymous. */
  session: SessionResponse | null | undefined;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signup: (input: SignupInput) => Promise<SessionResponse>;
  login: (input: LoginInput) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  /**
   * Switch to a different persona owned by the same account. Mints a new
   * access token server-side (keyed by the session ID in the current
   * JWT), replaces our session state, and reschedules the refresh timer.
   * Throws an ApiError on bad target / archived / suspended persona.
   */
  switchPersona: (personaId: string) => Promise<SessionResponse>;
  /** Exposed primarily for the API helper — the current access token, or
   * `null` if not signed in. */
  accessToken: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh the access token this many ms before it actually expires. */
const REFRESH_MARGIN_MS = 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: undefined,
    loading: true,
  });

  // Track the refresh timer so we can clear it on logout / unmount. Using a
  // ref instead of state avoids re-renders when the timer changes.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback(
    (expiresAt: string, doRefresh: () => Promise<void>) => {
      clearRefreshTimer();
      const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
      // If the token already expired, refresh immediately. Otherwise
      // schedule for shortly before expiry.
      const delay = Math.max(0, msUntilExpiry - REFRESH_MARGIN_MS);
      refreshTimer.current = setTimeout(() => {
        void doRefresh();
      }, delay);
    },
    [clearRefreshTimer],
  );

  const doRefresh = useCallback(async (): Promise<void> => {
    try {
      const session = await api<SessionResponse>({
        method: 'POST',
        path: '/api/auth/refresh',
      });
      setState({ session, loading: false });
      scheduleRefresh(session.session.expiresAt, doRefresh);
    } catch (err) {
      // 401 == not logged in (or refresh cookie expired). Anything else we
      // log and treat the same — failing open would be worse than failing
      // closed here.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('Refresh failed:', err);
      }
      clearRefreshTimer();
      setState({ session: null, loading: false });
    }
  }, [clearRefreshTimer, scheduleRefresh]);

  // Bootstrap: try to pick up an existing session from the refresh cookie.
  useEffect(() => {
    void doRefresh();
    return () => clearRefreshTimer();
  }, [doRefresh, clearRefreshTimer]);

  const signup = useCallback(
    async (input: SignupInput): Promise<SessionResponse> => {
      const session = await api<SessionResponse>({
        method: 'POST',
        path: '/api/auth/signup',
        body: input,
      });
      setState({ session, loading: false });
      scheduleRefresh(session.session.expiresAt, doRefresh);
      return session;
    },
    [doRefresh, scheduleRefresh],
  );

  const login = useCallback(
    async (input: LoginInput): Promise<SessionResponse> => {
      const session = await api<SessionResponse>({
        method: 'POST',
        path: '/api/auth/login',
        body: input,
      });
      setState({ session, loading: false });
      scheduleRefresh(session.session.expiresAt, doRefresh);
      return session;
    },
    [doRefresh, scheduleRefresh],
  );

  const switchPersona = useCallback(
    async (personaId: string): Promise<SessionResponse> => {
      const current = state.session;
      if (!current) {
        // Defensive — the UI guards every call site with a session, but an
        // ApiError keeps the failure in the same shape the caller handles
        // for bad-target / archived-persona cases.
        throw new ApiError(401, {
          code: 'UNAUTHORIZED',
          message: 'Not signed in.',
        });
      }
      const session = await api<SessionResponse>({
        method: 'POST',
        path: '/api/personas/switch',
        body: { personaId },
        accessToken: current.session.accessToken,
      });
      setState({ session, loading: false });
      scheduleRefresh(session.session.expiresAt, doRefresh);
      return session;
    },
    [state, doRefresh, scheduleRefresh],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api<void>({ method: 'POST', path: '/api/auth/logout' });
    } catch (err) {
      // Even if logout fails server-side (network, already revoked, …) the
      // UX we want is "you are now logged out on this device". The API will
      // clear the cookie on success anyway; on failure the stale cookie
      // just won't refresh.
      console.error('Logout failed:', err);
    }
    clearRefreshTimer();
    setState({ session: null, loading: false });
  }, [clearRefreshTimer]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session: state.session,
      loading: state.loading,
      accessToken: state.session ? state.session.session.accessToken : null,
      signup,
      login,
      logout,
      switchPersona,
    }),
    [state, signup, login, logout, switchPersona],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
