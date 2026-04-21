'use client';

/**
 * Actor's current mutual contacts. One action — Remove — which symmetrically
 * drops both edges server-side via DELETE /api/contacts/:personaId. The row
 * disappears locally on success.
 *
 * Exposes an imperative `prependContact` via forwardRef so the page can drop
 * a freshly-accepted contact in without a refetch. When `refreshKey` bumps
 * we still do a full reload — the ref is purely an additive optimization.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import type { Contact } from '@porch/types/domain';
import type { ListContactsResponse } from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { UsernameLink } from '@/components/username-link';

interface ContactsListProps {
  refreshKey: number;
  onRemoved?: (personaId: string) => void;
}

export interface ContactsListHandle {
  /** Optimistically insert a contact the caller already obtained. Dedupes by persona id. */
  prependContact: (contact: Contact) => void;
}

export const ContactsList = forwardRef<ContactsListHandle, ContactsListProps>(
  function ContactsList({ refreshKey, onRemoved }, ref) {
    const { accessToken } = useAuth();
    const [contacts, setContacts] = useState<Contact[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

    const load = useCallback(
      async (signal?: AbortSignal) => {
        try {
          const res = await api<ListContactsResponse>({
            path: '/api/contacts',
            accessToken,
            signal,
          });
          setContacts(res.contacts);
          setError(null);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load your contacts.',
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

    useImperativeHandle(
      ref,
      () => ({
        prependContact: (contact: Contact) => {
          setContacts((curr) => {
            if (!curr) return [contact];
            if (curr.some((c) => c.persona.id === contact.persona.id)) return curr;
            return [contact, ...curr];
          });
        },
      }),
      [],
    );

    async function remove(personaId: string) {
      setPendingIds((curr) => {
        const next = new Set(curr);
        next.add(personaId);
        return next;
      });
      try {
        await api<void>({
          method: 'DELETE',
          path: `/api/contacts/${personaId}`,
          accessToken,
        });
        setContacts((curr) =>
          curr ? curr.filter((c) => c.persona.id !== personaId) : curr,
        );
        onRemoved?.(personaId);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not remove that contact.',
        );
      } finally {
        setPendingIds((curr) => {
          const next = new Set(curr);
          next.delete(personaId);
          return next;
        });
      }
    }

    if (contacts === null && error === null) {
      return (
        <p className="text-xs text-[hsl(var(--text-muted))]">Loading contacts…</p>
      );
    }
    if (error) {
      return (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      );
    }
    if (!contacts || contacts.length === 0) {
      return (
        <p className="text-sm text-[hsl(var(--text-muted))]">
          No contacts yet. Send a request to someone above to get started.
        </p>
      );
    }

    return (
      <ul className="space-y-2">
        {contacts.map((c) => {
          const isPending = pendingIds.has(c.persona.id);
          return (
            <li
              key={c.persona.id}
              className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <UsernameLink
                    username={c.persona.username}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {c.persona.displayName}
                  </UsernameLink>
                  <UsernameLink
                    username={c.persona.username}
                    className="block text-xs text-[hsl(var(--text-muted))] underline-offset-2 hover:underline"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void remove(c.persona.id)}
                  disabled={isPending}
                  className="shrink-0 rounded-md border border-[hsl(var(--border-default))] px-2.5 py-1 text-xs text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Remove @${c.persona.username}`}
                >
                  {isPending ? '…' : 'Remove'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  },
);
