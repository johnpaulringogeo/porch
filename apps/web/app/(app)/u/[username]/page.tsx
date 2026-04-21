'use client';

/**
 * Public profile page — `/u/[username]`.
 *
 * Loads the viewer-scoped PublicProfile, renders a small header (display
 * name, handle, bio, join date, post count) and one relationship action
 * appropriate to `contactStatus`. Below that, the author's viewer-visible
 * posts stream in via <PersonaPosts>.
 *
 * Why the whole page is a client component:
 *   - username lives in the URL; posts pagination is client-only;
 *   - the Send-request action needs to mutate contactStatus in place
 *     without a full route refresh.
 *
 * NotFound → we render an inline "No such user" panel rather than calling
 * notFound(). The server already 404s on archived/suspended personas, and
 * inlining keeps us inside the authenticated shell so nav stays rendered.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type {
  CreateContactRequestResponse,
  GetPersonaProfileResponse,
  PublicProfile,
} from '@porch/types/api';
import { ContactStatus } from '@porch/types/api';
import { ErrorCode } from '@porch/types';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PersonaPosts } from '@/components/persona-posts';

export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const usernameParam = Array.isArray(params?.username)
    ? params.username[0]
    : params?.username;
  const username = (usernameParam ?? '').toLowerCase();
  const { accessToken, session } = useAuth();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!username) return;
      try {
        const res = await api<GetPersonaProfileResponse>({
          path: `/api/personas/${encodeURIComponent(username)}/profile`,
          accessToken,
          signal,
        });
        setProfile(res.profile);
        setNotFound(false);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.code === ErrorCode.NotFound) {
          setNotFound(true);
          setProfile(null);
          setError(null);
          return;
        }
        setError(
          err instanceof ApiError ? err.message : 'Could not load this profile.',
        );
      }
    },
    [accessToken, username],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (!username) {
    // The dynamic segment is required; this would only fire on a direct
    // /u/ visit, which Next.js won't actually route here — defensive.
    return null;
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-6 text-sm text-[hsl(var(--text-muted))]">
          No user with handle{' '}
          <span className="font-medium">@{username}</span>.
        </div>
        <Link
          href="/contacts"
          className="text-xs text-mode-home underline-offset-2 hover:underline"
        >
          ← Back to contacts
        </Link>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!profile) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading profile…</p>
    );
  }

  const isSelf =
    session?.persona.id !== undefined && session.persona.id === profile.id;

  return (
    <div className="space-y-8">
      <ProfileHeader
        profile={profile}
        isSelf={isSelf}
        onContactStatusChange={(next) =>
          setProfile((curr) => (curr ? { ...curr, contactStatus: next } : curr))
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Posts</h2>
        <p className="text-xs text-[hsl(var(--text-muted))]">
          {profile.postCount === 1
            ? '1 post visible to you.'
            : `${profile.postCount} posts visible to you.`}
        </p>
        <PersonaPosts username={profile.username} isSelf={isSelf} />
      </section>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

interface ProfileHeaderProps {
  profile: PublicProfile;
  isSelf: boolean;
  /** Called when the viewer transitions from `none` → `pending_outgoing`. */
  onContactStatusChange: (next: ContactStatus) => void;
}

function ProfileHeader({
  profile,
  isSelf,
  onContactStatusChange,
}: ProfileHeaderProps) {
  return (
    <section className="space-y-4 rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {profile.displayName}
          </h1>
          <p className="text-sm text-[hsl(var(--text-muted))]">
            @{profile.username}
          </p>
          {profile.bio ? (
            <p className="mt-3 whitespace-pre-wrap text-sm">{profile.bio}</p>
          ) : null}
        </div>
        <ContactStatusAction
          profile={profile}
          isSelf={isSelf}
          onStatusChange={onContactStatusChange}
        />
      </div>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[hsl(var(--text-muted))]">
        <div className="flex items-center gap-1">
          <dt className="sr-only">Joined</dt>
          <dd>Joined {formatJoinDate(profile.joinedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Action button ─────────────────────────────────────────────────────────

interface ContactStatusActionProps {
  profile: PublicProfile;
  isSelf: boolean;
  onStatusChange: (next: ContactStatus) => void;
}

/**
 * The relationship CTA. Branches on contactStatus:
 *   self             → nothing (profile owner has no self-directed CTA)
 *   contact          → static "You're contacts" chip
 *   pending_outgoing → static "Request sent" chip
 *   pending_incoming → link to /contacts to accept (no inline accept yet —
 *                      the incoming list owns that action)
 *   none             → inline Send request button (no optional message —
 *                      that detail lives on the /contacts send form)
 */
function ContactStatusAction({
  profile,
  isSelf,
  onStatusChange,
}: ContactStatusActionProps) {
  const { accessToken } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) return null;

  if (profile.contactStatus === ContactStatus.Self) {
    // Belt-and-suspenders — isSelf and the server-computed self should
    // match, but we don't want to double-render if they diverge.
    return null;
  }

  if (profile.contactStatus === ContactStatus.Contact) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
        You&apos;re contacts
      </span>
    );
  }

  if (profile.contactStatus === ContactStatus.PendingOutgoing) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--surface-muted))] px-3 py-1 text-xs font-medium text-[hsl(var(--text-muted))]">
        Request sent
      </span>
    );
  }

  if (profile.contactStatus === ContactStatus.PendingIncoming) {
    return (
      <Link
        href="/contacts"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-mode-home px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        Review request
      </Link>
    );
  }

  // ContactStatus.None
  async function send() {
    setSubmitting(true);
    setError(null);
    try {
      await api<CreateContactRequestResponse>({
        method: 'POST',
        path: '/api/contacts/requests',
        body: { toPersonaUsername: profile.username },
        accessToken,
      });
      onStatusChange(ContactStatus.PendingOutgoing);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not send that request. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void send()}
        disabled={submitting}
        className="rounded-md bg-mode-home px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send contact request'}
      </button>
      {error ? (
        <p role="alert" className="max-w-[240px] text-right text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatJoinDate(iso: string): string {
  if (typeof window === 'undefined') return iso;
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
