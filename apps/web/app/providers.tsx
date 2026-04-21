'use client';

/**
 * Root-level client providers. Next's App Router wants a single client
 * boundary at the top so server components below can stay server — everything
 * that depends on auth state renders as a child of this tree.
 *
 * NotificationsProvider sits inside AuthProvider so it can react to session
 * changes (login / logout / persona-switch) by re-fetching the unread count.
 */

import { AuthProvider } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </AuthProvider>
  );
}
