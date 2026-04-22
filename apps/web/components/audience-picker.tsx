'use client';

/**
 * Audience picker for the Home composer. Two modes:
 *   - All contacts (default — fanout to every mutual)
 *   - Selected people (server requires at least one persona id)
 *
 * Contacts are lazy-loaded the first time the user switches to "Selected"
 * and cached for the lifetime of the component — most posts are to all
 * contacts, so paying the round-trip up front would be wasted.
 *
 * State-shape note: this is a controlled component. The parent owns
 * `value` and gets `onChange` callbacks; we don't track which mode/IDs
 * are "current" internally because the compose form already needs that
 * to build the request body, and a single source of truth keeps reset-
 * after-post trivial.
 */

import { useEffect, useState } from 'react';
import type { Contact } from '@porch/types/domain';
import { PostAudienceMode } from '@porch/types/domain';
import type { ListContactsResponse } from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export interface AudienceSelection {
  mode: PostAudienceMode;
  /** Persona IDs selected when mode === 'selected'. Empty otherwise. */
  selectedIds: string[];
}

interface AudiencePickerProps {
  value: AudienceSelection;
  onChange: (next: AudienceSelection) => void;
  /** Disable interaction while compose is submitting. */
  disabled?: boolean;
}

export function AudiencePicker({ value, onChange, disabled }: AudiencePickerProps) {
  const { accessToken } = useAuth();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelected = value.mode === PostAudienceMode.Selected;

  // Lazy-fetch the contacts list the first time the user switches to
  // Selected. Once we have it, keep it — toggling back to All Contacts and
  // returning to Selected shouldn't refetch.
  useEffect(() => {
    if (!isSelected || contacts !== null || loading) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<ListContactsResponse>({
      path: '/api/contacts',
      accessToken,
      signal: ctrl.signal,
    })
      .then((res) => {
        setContacts(res.contacts);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your contacts.',
        );
      })
      .finally(() => {
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [isSelected, contacts, loading, accessToken]);

  function setMode(next: PostAudienceMode) {
    onChange({
      mode: next,
      // Drop the selection when leaving Selected so a subsequent post starts
      // from a clean default. Cheap UX cost (re-tick boxes), eliminates the
      // "did I post to the right people?" foot-gun.
      selectedIds: next === PostAudienceMode.Selected ? value.selectedIds : [],
    });
  }

  function togglePersona(personaId: string) {
    const present = value.selectedIds.includes(personaId);
    onChange({
      mode: PostAudienceMode.Selected,
      selectedIds: present
        ? value.selectedIds.filter((id) => id !== personaId)
        : [...value.selectedIds, personaId],
    });
  }

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="sr-only">Who can see this post</legend>

      <div className="flex flex-wrap gap-4 text-xs text-[hsl(var(--text-muted))]">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name="audience-mode"
            checked={!isSelected}
            onChange={() => setMode(PostAudienceMode.AllContacts)}
            className="h-3.5 w-3.5"
          />
          <span>All contacts</span>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name="audience-mode"
            checked={isSelected}
            onChange={() => setMode(PostAudienceMode.Selected)}
            className="h-3.5 w-3.5"
          />
          <span>
            Selected people
            {value.selectedIds.length > 0 ? ` (${value.selectedIds.length})` : ''}
          </span>
        </label>
      </div>

      {isSelected ? (
        <div className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-3">
          {loading ? (
            <p className="text-xs text-[hsl(var(--text-muted))]">
              Loading your contacts…
            </p>
          ) : error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : !contacts || contacts.length === 0 ? (
            <p className="text-xs text-[hsl(var(--text-muted))]">
              You don&apos;t have any contacts yet. Add some from the Contacts page.
            </p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {contacts.map((c) => {
                const checked = value.selectedIds.includes(c.persona.id);
                return (
                  <li key={c.persona.id}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePersona(c.persona.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="font-medium">{c.persona.displayName}</span>
                      <span className="text-[hsl(var(--text-muted))]">
                        @{c.persona.username}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}
