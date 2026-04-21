'use client';

/**
 * Pending contact requests sent *to* the actor. Each row has two buttons —
 * Accept / Decline — that POST to /api/contacts/requests/:id/respond with
 * `accept: true|false`.
 *
 * On accept the server returns the newly-minted actor-side Contact in the
 * same response, so the parent can drop it straight into the contacts list
 * via `onAccepted(contact)` — no refetch needed for the just-accepted row.
 * We still bump the incoming key so any future incoming requests refresh.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Contact, ContactRequest } from '@porch/types/domain';
import type {
  ListContactRequestsResponse,
  RespondToContactRequestResponse,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { UsernameLink } from '@/components/username-link';

interface IncomingRequestsProps {
  refreshKey: number;
  onAccepted?: (contact: Contact) => void;
  onDeclined?: (requestId: string) => void;
}

export function IncomingRequests({
  refreshKey,
  onAccepted,
  onDeclined,
}: IncomingRequestsProps) {
  const { accessToken } = useAuth();
  const [requests, setRequests] = useState<ContactRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track in-flight ids so we can disable their buttons without a separate state ref.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListContactRequestsResponse>({
          path: '/api/contacts/requests',
          accessToken,
          signal,
        });
        setRequests(res.requests);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load incoming requests.',
        );
      }
    },
    [accessToken],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, refreshKey]);

  async function respond(requestId: string, accept: boolean) {
    setPendingIds((curr) => {
      const next = new Set(curr);
      next.add(requestId);
      return next;
    });
    try {
      const res = await api<RespondToContactRequestResponse>({
        method: 'POST',
        path: `/api/contacts/requests/${requestId}/respond`,
        body: { accept },
        accessToken,
      });
      // Drop the responded-to row locally so the UI feels instant.
      setRequests((curr) =>
        curr ? curr.filter((r) => r.id !== requestId) : curr,
      );
      if (accept && res.contact) {
        onAccepted?.(res.contact);
      } else if (!accept) {
        onDeclined?.(requestId);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not respond to that request.',
      );
    } finally {
      setPendingIds((curr) => {
        const next = new Set(curr);
        next.delete(requestId);
        return next;
      });
    }
  }

  if (requests === null && error === null) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading incoming requests…</p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (!requests || requests.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--text-muted))]">
        No incoming requests right now.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {requests.map((req) => {
        const isPending = pendingIds.has(req.id);
        return (
          <li
            key={req.id}
            className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <UsernameLink
                  username={req.from.username}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {req.from.displayName}
                </UsernameLink>
                <UsernameLink
                  username={req.from.username}
                  className="block text-xs text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
                />
                {req.message ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{req.message}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void respond(req.id, false)}
                  disabled={isPending}
                  className="rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 text-xs text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => void respond(req.id, true)}
                  disabled={isPending}
                  className="rounded-md bg-mode-home px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? '…' : 'Accept'}
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
