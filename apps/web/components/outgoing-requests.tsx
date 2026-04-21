'use client';

/**
 * Pending contact requests the actor has *sent*. Only action here is to
 * retract — POST /api/contacts/requests/:id/cancel. We drop the row locally
 * on success so the UI feels snappy.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ContactRequest } from '@porch/types/domain';
import type {
  CreateContactRequestResponse,
  ListContactRequestsResponse,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { UsernameLink } from '@/components/username-link';

interface OutgoingRequestsProps {
  refreshKey: number;
  onCancelled?: (requestId: string) => void;
}

export function OutgoingRequests({
  refreshKey,
  onCancelled,
}: OutgoingRequestsProps) {
  const { accessToken } = useAuth();
  const [requests, setRequests] = useState<ContactRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListContactRequestsResponse>({
          path: '/api/contacts/requests/outgoing',
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
            : 'Could not load outgoing requests.',
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

  async function cancel(requestId: string) {
    setPendingIds((curr) => {
      const next = new Set(curr);
      next.add(requestId);
      return next;
    });
    try {
      // Response shape matches CreateContactRequestResponse (single request).
      await api<CreateContactRequestResponse>({
        method: 'POST',
        path: `/api/contacts/requests/${requestId}/cancel`,
        accessToken,
      });
      setRequests((curr) =>
        curr ? curr.filter((r) => r.id !== requestId) : curr,
      );
      onCancelled?.(requestId);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not cancel that request.',
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
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading outgoing requests…</p>
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
        No outgoing requests pending.
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
                  username={req.to.username}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {req.to.displayName}
                </UsernameLink>
                <UsernameLink
                  username={req.to.username}
                  className="block text-xs text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
                />
                {req.message ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[hsl(var(--text-muted))]">
                    &ldquo;{req.message}&rdquo;
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void cancel(req.id)}
                disabled={isPending}
                className="shrink-0 rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 text-xs text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? '…' : 'Cancel'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
