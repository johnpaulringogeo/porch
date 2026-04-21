'use client';

/**
 * Gate for the authenticated section. On mount we wait for the AuthProvider
 * to finish its refresh probe, then either render the app or push the user
 * to /login. A tiny wrapper keeps server components below this boundary
 * unaware of auth — they just render, assuming they're logged in.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { UsernameLink } from '@/components/username-link';

/**
 * Top-level nav items for the authenticated header. The `badge` key names
 * which value-source to render next to the label — right now only the
 * Notifications item opts in. Keeping it declarative means a future "DMs"
 * or "Mentions" item can pick an existing or new badge source without
 * growing a special-case branch in the JSX.
 */
type NavBadge = 'unread-notifications';

const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  badge?: NavBadge;
}> = [
  { href: '/dashboard', label: 'Home' },
  { href: '/feed', label: 'Feed' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/notifications', label: 'Notifications', badge: 'unread-notifications' },
];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, logout } = useAuth();
  const { unreadCount } = useNotifications();

  useEffect(() => {
    if (!loading && session === null) {
      router.replace('/login');
    }
  }, [loading, session, router]);

  if (loading || session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[hsl(var(--text-muted))]">
        Loading…
      </div>
    );
  }

  // `session === null` → we've already kicked off a redirect, render nothing
  // to avoid flashing dashboard chrome for a logged-out user.
  if (!session) return null;

  return (
    <div className="min-h-screen bg-[hsl(var(--surface-default))]">
      <header className="border-b border-[hsl(var(--border-default))]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm font-semibold tracking-tight"
            >
              Porch
            </Link>
            <span
              aria-label="Active mode: Home"
              className="inline-flex items-center gap-1.5 rounded-full bg-mode-home-surface px-2 py-0.5 text-[11px] font-medium text-mode-home ring-1 ring-mode-home/25"
            >
              <span className="h-1 w-1 rounded-full bg-mode-home" />
              Home
            </span>
          </div>
          <nav aria-label="Primary" className="hidden sm:block">
            <ul className="flex items-center gap-1 text-sm">
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                // Resolve the badge value by source. Today there's only one
                // source; the switch keeps the call-site readable when a
                // second one lands.
                const badgeCount =
                  item.badge === 'unread-notifications'
                    ? (unreadCount ?? 0)
                    : 0;
                const showBadge = badgeCount > 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--surface-muted))] px-3 py-1 text-sm font-medium'
                          : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))]'
                      }
                    >
                      {item.label}
                      {showBadge ? (
                        <span
                          aria-label={`${badgeCount} unread`}
                          className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-mode-home px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                        >
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <UsernameLink
              username={session.persona.username}
              className="text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
            />
            <button
              type="button"
              onClick={() => {
                void logout().then(() => router.replace('/'));
              }}
              className="rounded-md border border-[hsl(var(--border-default))] px-3 py-1 text-xs hover:bg-[hsl(var(--surface-muted))]"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
