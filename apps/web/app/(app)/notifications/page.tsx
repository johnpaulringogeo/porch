'use client';

/**
 * Notifications page. Thin wrapper over <NotificationsList> — the route
 * exists to give the inbox its own URL and header chrome; the component
 * does all the data work and mutations.
 */

import { useAuth } from '@/lib/auth-context';
import { NotificationsList } from '@/components/notifications-list';

export default function NotificationsPage() {
  const { session } = useAuth();
  if (!session) return null; // layout already gated

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Contact requests, acceptances, and system updates. Newest first.
        </p>
      </section>

      <NotificationsList />
    </div>
  );
}
