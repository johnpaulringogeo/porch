'use client';

/**
 * Global notifications state. We lift the unread count into a context so the
 * header badge and the /notifications page can't drift out of sync — the
 * page mutates via setUnreadCount after a mark-read/dismiss, and the header
 * re-renders immediately.
 *
 * The provider fetches an initial count whenever the logged-in persona
 * changes. There's no polling — for v0 the user will either land on
 * /notifications (which re-fetches on mount) or refresh the page to see new
 * unreads. We can add polling or SSE later without changing the consumer API.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { ListNotificationsResponse } from '@porch/types/api';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';

interface NotificationsContextValue {
  /** `null` until the first fetch settles (success or failure). */
  unreadCount: number | null;
  /** Set directly — used by the notifications page after a write. */
  setUnreadCount: (n: number) => void;
  /** Force a refetch of just the count. */
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session, accessToken } = useAuth();
  const [unreadCount, setUnreadCountState] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      // limit=1 — we only care about the count. The server always returns
      // `unreadCount` regardless of page size.
      const res = await api<ListNotificationsResponse>({
        path: '/api/notifications?limit=1',
        accessToken,
      });
      setUnreadCountState(res.unreadCount);
    } catch (err) {
      // Don't blow up the whole shell over a badge fetch — just log. A 401
      // here is usually a race with refresh that self-heals on next tick.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('notifications-refresh-failed', err);
      }
    }
  }, [accessToken, session]);

  // Refetch whenever the persona changes (login/logout/switch). We key on
  // persona id rather than the session object so a persona-switch triggers
  // a refetch but a fresh-access-token rewrite of `session` (same persona,
  // new token) doesn't. `refresh` itself depends on both accessToken and
  // session, so token changes still flow through the callback identity.
  useEffect(() => {
    if (!session) {
      setUnreadCountState(null);
      return;
    }
    void refresh();
  }, [session?.persona.id, refresh]);

  const value: NotificationsContextValue = {
    unreadCount,
    setUnreadCount: setUnreadCountState,
    refresh,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used inside <NotificationsProvider>');
  }
  return ctx;
}
