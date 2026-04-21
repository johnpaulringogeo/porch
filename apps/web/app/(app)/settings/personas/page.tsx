'use client';

/**
 * Manage personas — `/settings/personas`.
 *
 * Lists every non-archived persona on the signed-in account and exposes
 * two per-row actions:
 *
 *   Switch    — only shown on non-active rows. Calls auth-context, which
 *               mints a fresh access token and re-renders the header.
 *   Archive   — only shown on rows that are neither the default nor the
 *               currently active persona (the server rejects both with
 *               409, so gating the button keeps the UX tidy — a surprised
 *               user who clicks anyway still gets a readable error).
 *
 * Confirmation for archive is inline (not a modal): clicking Archive
 * swaps the row into a "Archive @username? [Archive] [Cancel]" state.
 * Keeps the destructive action two clicks away without pulling in a
 * full dialog primitive for a single surface. An earlier draft used
 * window.confirm() — ugly, blocks the event loop, and ships differently
 * per browser.
 *
 * We don't render a "Create persona" button yet. POST /api/personas
 * exists but the UI is out of scope for this round; when it lands, it
 * slots in above the list.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  ArchivePersonaResponse,
  ListMyPersonasResponse,
  MyPersona,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function ManagePersonasPage() {
  const router = useRouter();
  const { session, accessToken, switchPersona } = useAuth();

  const [personas, setPersonas] = useState<MyPersona[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(
    null,
  );

  const load = useCallback(
    async (signal?: AbortSignal, token?: string | null) => {
      const useToken = token ?? accessToken;
      if (!useToken) return;
      try {
        const res = await api<ListMyPersonasResponse>({
          path: '/api/personas',
          accessToken: useToken,
          signal,
        });
        setPersonas(res.personas);
        setLoadError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your personas. Please reload the page.',
        );
      }
    },
    [accessToken],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const onSwitch = useCallback(
    async (p: MyPersona) => {
      if (p.isActive || switching) return;
      setSwitching(p.id);
      setRowError(null);
      try {
        await switchPersona(p.id);
        // Patch isActive flags locally so the row UI updates without a
        // second request; the backing session state is already replaced.
        setPersonas((prev) =>
          prev ? prev.map((row) => ({ ...row, isActive: row.id === p.id })) : prev,
        );
        // Server components (feed, profile, etc.) see a new session;
        // refresh so any pages already in the back/forward cache get
        // re-rendered against the new actor.
        router.refresh();
      } catch (err) {
        setRowError({
          id: p.id,
          message:
            err instanceof ApiError ? err.message : 'Could not switch personas.',
        });
      } finally {
        setSwitching(null);
      }
    },
    [router, switching, switchPersona],
  );

  const onArchive = useCallback(
    async (p: MyPersona) => {
      if (archiving) return;
      setArchiving(p.id);
      setRowError(null);
      try {
        await api<ArchivePersonaResponse>({
          method: 'POST',
          path: `/api/personas/${encodeURIComponent(p.id)}/archive`,
          accessToken,
        });
        setPersonas((prev) => (prev ? prev.filter((row) => row.id !== p.id) : prev));
        setConfirmingArchive(null);
      } catch (err) {
        setRowError({
          id: p.id,
          message:
            err instanceof ApiError ? err.message : 'Could not archive persona.',
        });
      } finally {
        setArchiving(null);
      }
    },
    [accessToken, archiving],
  );

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-sm text-[hsl(var(--text-muted))]">
            Switch between personas or archive ones you no longer use. Your
            default persona can&apos;t be archived.
          </p>
        </div>
        <Link
          href="/settings/personas/new"
          className="inline-flex flex-none items-center rounded-md bg-mode-home px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          Create persona
        </Link>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      {personas === null && !loadError ? (
        <p className="text-sm text-[hsl(var(--text-muted))]">Loading personas…</p>
      ) : null}

      {personas && personas.length > 0 ? (
        <ul className="divide-y divide-[hsl(var(--border-default))] rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))]">
          {personas.map((p) => (
            <PersonaRow
              key={p.id}
              persona={p}
              switching={switching === p.id}
              archiving={archiving === p.id}
              confirming={confirmingArchive === p.id}
              error={rowError?.id === p.id ? rowError.message : null}
              onSwitch={() => void onSwitch(p)}
              onStartConfirm={() => {
                setConfirmingArchive(p.id);
                setRowError(null);
              }}
              onCancelConfirm={() => setConfirmingArchive(null)}
              onArchive={() => void onArchive(p)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────

interface PersonaRowProps {
  persona: MyPersona;
  switching: boolean;
  archiving: boolean;
  confirming: boolean;
  error: string | null;
  onSwitch: () => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onArchive: () => void;
}

function PersonaRow({
  persona,
  switching,
  archiving,
  confirming,
  error,
  onSwitch,
  onStartConfirm,
  onCancelConfirm,
  onArchive,
}: PersonaRowProps) {
  const canArchive = !persona.isDefault && !persona.isActive;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/u/${persona.username}`}
            className="truncate text-sm font-medium underline-offset-2 hover:underline"
          >
            {persona.displayName}
          </Link>
          {persona.isActive ? (
            <span className="inline-flex items-center rounded-full bg-mode-home-surface px-2 py-0.5 text-[10px] font-medium text-mode-home">
              Active
            </span>
          ) : null}
          {persona.isDefault ? (
            <span className="inline-flex items-center rounded-full bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--text-muted))]">
              Default
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-[hsl(var(--text-muted))]">
          @{persona.username}
        </p>
        {error ? (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[hsl(var(--text-muted))]">
            Archive @{persona.username}?
          </span>
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {archiving ? 'Archiving…' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={onCancelConfirm}
            disabled={archiving}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!persona.isActive ? (
            <button
              type="button"
              onClick={onSwitch}
              disabled={switching}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 font-medium hover:bg-[hsl(var(--surface-muted))] disabled:opacity-50"
            >
              {switching ? 'Switching…' : 'Switch'}
            </button>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              onClick={onStartConfirm}
              className="inline-flex items-center rounded-md border border-red-200 px-2.5 py-1 font-medium text-red-700 hover:bg-red-50"
            >
              Archive
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}
