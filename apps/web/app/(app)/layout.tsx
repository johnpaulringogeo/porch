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

/**
 * Top-level nav items for the authenticated header. Keeping this as a
 * constant next to the layout makes it trivial to add a `/feed` (or
 * similar) entry once that page ships — no routing indirection needed.
 */
const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Home' },
  { href: '/feed', label: 'Feed' },
  { href: '/contacts', label: 'Contacts' },
];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, logout } = useAuth();

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
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'rounded-md bg-[hsl(var(--surface-muted))] px-3 py-1 text-sm font-medium'
                          : 'rounded-md px-3 py-1 text-sm text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))]'
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[hsl(var(--text-muted))]">
              @{session.persona.username}
            </span>
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
