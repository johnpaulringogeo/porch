'use client';

/**
 * Header dropdown that lists the signed-in account's personas and lets the
 * user switch between them. Opens on click, closes on outside click /
 * Escape / route change. Switching calls auth-context.switchPersona, which
 * POSTs /api/personas/switch and replaces the session state — Next.js
 * route components that read session.persona.* re-render automatically.
 *
 * We intentionally fetch personas lazily on the first open rather than on
 * mount: the list is tiny but the UI sits on every authenticated page and
 * we'd rather not burn a request per navigation for a surface most users
 * won't interact with.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth, type SessionResponse } from '@/lib/auth-context';

interface MyPersona {
  id: string;
  username: string;
  did: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  isActive: boolean;
}

interface ListResponse {
  personas: MyPersona[];
}

export function PersonaSwitcher() {
  const router = useRouter();
  const { session, accessToken, switchPersona, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<MyPersona[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loadPersonas = useCallback(
    async (token: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<ListResponse>({
          method: 'GET',
          path: '/api/personas',
          accessToken: token,
        });
        setPersonas(res.personas);
      } catch (err) {
        // 401 means the token just expired — an auth refresh is in flight
        // elsewhere; falling back to a null list shows a retry affordance
        // without tearing the whole dropdown down.
        if (err instanceof ApiError) {
          setError(err.message || 'Could not load personas.');
        } else {
          setError('Could not load personas.');
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const onOpen = useCallback(() => {
    setOpen(true);
    // Always refetch on open so the `isActive` flag and any newly-created
    // personas are current. The list is small and the request is cheap.
    if (accessToken) void loadPersonas(accessToken);
  }, [accessToken, loadPersonas]);

  const onSwitch = useCallback(
    async (p: MyPersona) => {
      if (p.isActive || switching) return;
      setSwitching(p.id);
      setError(null);
      try {
        const next: SessionResponse = await switchPersona(p.id);
        // Update the local list's isActive flags so the check mark moves
        // without waiting for the next open → fetch cycle.
        setPersonas((prev) =>
          prev
            ? prev.map((row) => ({ ...row, isActive: row.id === next.persona.id }))
            : prev,
        );
        setOpen(false);
        // Feed/dashboard both depend on who we're acting as; the cleanest
        // post-switch experience is a fresh render of whatever page the
        // user is on. router.refresh() handles Server Components and any
        // client components that hold a stale first-load snapshot.
        router.refresh();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Could not switch.';
        setError(msg);
      } finally {
        setSwitching(null);
      }
    },
    [router, switching, switchPersona],
  );

  if (!session) return null;

  const active = session.persona;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : onOpen())}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))]"
      >
        <span>@{active.username}</span>
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-1 text-sm shadow-lg"
        >
          <div className="px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--text-muted))]">
              Acting as
            </div>
            <div className="mt-0.5 truncate font-medium">{active.displayName}</div>
            <div className="truncate text-[hsl(var(--text-muted))]">
              @{active.username}
            </div>
          </div>
          <div className="my-1 border-t border-[hsl(var(--border-default))]" />
          <div className="max-h-72 overflow-y-auto">
            {loading && !personas ? (
              <div className="px-3 py-2 text-xs text-[hsl(var(--text-muted))]">
                Loading personas…
              </div>
            ) : null}
            {error ? (
              <div className="px-3 py-2 text-xs text-red-600">{error}</div>
            ) : null}
            {personas?.map((p) => {
              const isSwitching = switching === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.isActive}
                  onClick={() => void onSwitch(p)}
                  disabled={p.isActive || isSwitching}
                  className={
                    p.isActive
                      ? 'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm'
                      : 'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50'
                  }
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center text-[hsl(var(--text-muted))]"
                  >
                    {p.isActive ? (
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3.5 8.5l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.displayName}
                      {p.isDefault ? (
                        <span className="ml-1 align-middle text-[10px] font-normal text-[hsl(var(--text-muted))]">
                          default
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-[hsl(var(--text-muted))]">
                      @{p.username}
                    </span>
                  </span>
                  {isSwitching ? (
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">…</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="my-1 border-t border-[hsl(var(--border-default))]" />
          <Link
            href={`/u/${active.username}`}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-sm hover:bg-[hsl(var(--surface-muted))]"
            role="menuitem"
          >
            View profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout().then(() => router.replace('/'));
            }}
            className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[hsl(var(--surface-muted))]"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
