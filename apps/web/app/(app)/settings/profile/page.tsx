'use client';

/**
 * Edit-profile settings page — `/settings/profile`.
 *
 * Bound to the *currently active* persona, which is the one whose displayName
 * + bio appear on `/u/<active.username>`. To edit a different persona, switch
 * to it first via the header dropdown (then come back here).
 *
 * Save flow:
 *   1. PATCH /api/personas/:activeId with the diff
 *   2. On success, call refreshSession() so the header dropdown / @username
 *      label re-render against the new displayName
 *   3. Show a transient "Saved" confirmation; stay on the page so the user
 *      can keep tweaking without an extra round-trip
 *
 * The current persona's bio isn't in the SessionResponse, so we fetch the
 * canonical row once on mount via GET /personas/:username/profile (the same
 * endpoint the public profile page uses — fine because the viewer is the
 * subject and the response shape already exposes bio).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  GetPersonaProfileResponse,
  UpdatePersonaResponse,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** Mirror the server bounds so the form trips its own message before the
 * round-trip — the API also enforces these via zod, so the duplication
 * here is purely UX (the regex/length toast is ours, the canonical
 * authority is the server). */
const DISPLAY_NAME_MAX = 64;
const BIO_MAX = 280;

export default function EditProfilePage() {
  const { session, accessToken, refreshSession } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [original, setOriginal] = useState<{ displayName: string; bio: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fetch the current bio + displayName. We could lift displayName out of
  // session.persona.displayName directly, but loading both from one source
  // avoids the awkward case where displayName updates instantly (from the
  // session) but bio shows blank for a frame while the fetch resolves.
  useEffect(() => {
    if (!session || !accessToken) return;
    const username = session.persona.username;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    api<GetPersonaProfileResponse>({
      path: `/api/personas/${encodeURIComponent(username)}/profile`,
      accessToken,
      signal: ctrl.signal,
    })
      .then((res) => {
        const dn = res.profile.displayName;
        const b = res.profile.bio ?? '';
        setDisplayName(dn);
        setBio(b);
        setOriginal({ displayName: dn, bio: b });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your profile. Please reload the page.',
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [session, accessToken]);

  const trimmedDisplay = displayName.trim();
  const displayValid =
    trimmedDisplay.length > 0 && trimmedDisplay.length <= DISPLAY_NAME_MAX;
  const bioValid = bio.length <= BIO_MAX;

  // Compute a minimal patch — only send fields that actually changed. An
  // empty patch is allowed by the server but we'd rather skip the trip
  // entirely so the "Saved" flash means something happened.
  const patch = useCallback((): { displayName?: string; bio?: string | null } => {
    if (!original) return {};
    const out: { displayName?: string; bio?: string | null } = {};
    if (trimmedDisplay !== original.displayName) out.displayName = trimmedDisplay;
    // Empty string → null so the server clears the column rather than
    // storing whitespace.
    const nextBio = bio.trim().length === 0 ? null : bio;
    const origBio = original.bio.trim().length === 0 ? null : original.bio;
    if (nextBio !== origBio) out.bio = nextBio;
    return out;
  }, [bio, original, trimmedDisplay]);

  const dirty = Object.keys(patch()).length > 0;
  const canSubmit = !submitting && !loading && displayValid && bioValid && dirty;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !session) return;
    setSubmitting(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await api<UpdatePersonaResponse>({
        method: 'PATCH',
        path: `/api/personas/${encodeURIComponent(session.persona.id)}`,
        body: patch(),
        accessToken,
      });
      const dn = res.persona.displayName;
      const b = res.persona.bio ?? '';
      setDisplayName(dn);
      setBio(b);
      setOriginal({ displayName: dn, bio: b });
      setSaved(true);
      // Refresh the session so the header dropdown picks up the new
      // displayName immediately — without this the change only takes
      // effect on the next scheduled refresh (~14 minutes worst case).
      void refreshSession();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : 'Could not save your changes. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit profile</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Editing{' '}
          <Link
            href={`/u/${session.persona.username}`}
            className="font-medium underline underline-offset-2"
          >
            @{session.persona.username}
          </Link>
          . Username can&apos;t be changed.
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="block text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            disabled={loading}
            maxLength={DISPLAY_NAME_MAX + 32}
            className="block w-full rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mode-home/40 disabled:opacity-60"
          />
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {trimmedDisplay.length}/{DISPLAY_NAME_MAX}
            {trimmedDisplay.length === 0 ? ' — required' : null}
            {trimmedDisplay.length > DISPLAY_NAME_MAX
              ? ' — too long'
              : null}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bio" className="block text-sm font-medium">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setSaved(false);
            }}
            disabled={loading}
            rows={4}
            placeholder="A short line or two about this persona."
            className="block w-full resize-y rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-2 text-sm placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-mode-home/40 disabled:opacity-60"
          />
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {bio.length}/{BIO_MAX}
            {bio.length > BIO_MAX ? ' — too long' : null}
          </p>
        </div>

        {saveError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {saveError}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !dirty ? (
            <span className="text-xs text-emerald-700" role="status">
              Saved
            </span>
          ) : null}
          {!loading && !dirty && !saved ? (
            <span className="text-xs text-[hsl(var(--text-muted))]">
              No changes to save
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
