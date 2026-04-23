'use client';

/**
 * Account activity log — `/settings/account/activity`.
 *
 * Paginated view of the caller's own audit trail. The server guarantees we
 * only see rows tied to our own account_id, so there's no visibility
 * computation to do client-side. Friendly labels are mapped from the
 * `<entity>.<verb>` action strings written at the API layer; unknown actions
 * fall back to the raw string so a new writer vocabulary can't break this
 * page — the worst-case UX is a line that reads `post.hide` instead of
 * "Hid a post".
 *
 * IP + user-agent are shown on hover (title attribute) rather than inline:
 * they're often absent, and surfacing them as prominent metadata would make
 * the list harder to scan for the typical "when did I last sign in?" use
 * case. Power users who need them can hover; normal users see a clean list.
 *
 * Pagination is the same keyset-cursor / "Load more" pattern as notifications
 * and the home feed — if a user scrolls far enough back we'll happily walk
 * years of entries without server-side offset pain.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AuditEntry,
  ListAccountAuditResponse,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const PAGE_SIZE = 50;

export default function AccountActivityPage() {
  const { session, accessToken } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      if (!accessToken) return;
      try {
        const res = await api<ListAccountAuditResponse>({
          path: `/api/account/audit?limit=${PAGE_SIZE}`,
          accessToken,
          signal,
        });
        setEntries(res.entries);
        setCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your activity log.',
        );
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (!accessToken) return;
    const ctrl = new AbortController();
    void loadInitial(ctrl.signal);
    return () => ctrl.abort();
  }, [accessToken, loadInitial]);

  async function loadMore() {
    if (!cursor || loadingMore || !accessToken) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api<ListAccountAuditResponse>({
        path: `/api/account/audit?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        accessToken,
      });
      setEntries((curr) => (curr ? [...curr, ...res.entries] : res.entries));
      setCursor(res.nextCursor);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load more activity.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
          <Link
            href="/settings/account"
            className="underline-offset-2 hover:underline"
          >
            Account
          </Link>
          <span aria-hidden>/</span>
          <span>Activity</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Actions taken on your account, newest first. Hover a row to see the
          originating IP address and browser when available.
        </p>
      </header>

      {entries === null && error === null ? (
        <p className="text-sm text-[hsl(var(--text-muted))]">Loading…</p>
      ) : null}

      {error && entries === null ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-6 text-sm text-[hsl(var(--text-muted))]">
          No activity yet. Sign-ins, posts, and other account-level actions
          will show up here.
        </div>
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <>
          <ul className="space-y-2">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>

          {/* Error from a loadMore that happened after the initial page rendered. */}
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}

          {cursor ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-4 py-1.5 text-xs font-medium text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : (
            <p className="pt-2 text-center text-xs text-[hsl(var(--text-muted))]">
              That&apos;s the full history for this account.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: AuditEntry }) {
  // Hover tooltip: only surface fields that actually have a value. Joining
  // empty strings would leave stray `· ·` separators.
  const hoverParts: string[] = [];
  if (entry.ipAddress) hoverParts.push(`IP ${entry.ipAddress}`);
  if (entry.userAgent) hoverParts.push(entry.userAgent);
  const hoverTitle = hoverParts.length > 0 ? hoverParts.join(' · ') : undefined;

  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-4 text-sm"
      title={hoverTitle}
    >
      <div className="flex-1 space-y-1">
        <p className="font-medium">{labelForAction(entry.action)}</p>
        <p className="text-xs text-[hsl(var(--text-muted))]">
          <code className="font-mono">{entry.action}</code>
          {entry.entityType && entry.entityId ? (
            <>
              {' · '}
              <span>
                {entry.entityType}{' '}
                <code className="font-mono">
                  {truncateId(entry.entityId)}
                </code>
              </span>
            </>
          ) : null}
        </p>
      </div>
      <time
        dateTime={entry.createdAt}
        className="flex-none pt-0.5 text-xs tabular-nums text-[hsl(var(--text-muted))]"
      >
        {formatTimestamp(entry.createdAt)}
      </time>
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map known `<entity>.<verb>` action strings to a friendly one-line label.
 * Every writer call site in `apps/api/src/routes/*` is enumerated here. When
 * a new action is introduced and this map isn't updated, the row renders
 * `humanizeRawAction(action)` — never a blank — so the UI stays honest and
 * the list stays scannable.
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'auth.signup': 'Created your account',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',

  'account.deletion_requested': 'Requested account deletion',
  'account.deletion_cancelled': 'Cancelled account deletion',

  'persona.create': 'Created a persona',
  'persona.update': 'Updated a persona',
  'persona.switch': 'Switched active persona',
  'persona.archive': 'Archived a persona',

  'post.create': 'Posted',
  'post.edit': 'Edited a post',
  'post.delete': 'Deleted a post',
  'post.like': 'Liked a post',
  'post.unlike': 'Unliked a post',

  'comment.create': 'Commented on a post',
  'comment.update': 'Edited a comment',
  'comment.delete': 'Deleted a comment',

  'contact.request.create': 'Sent a contact request',
  'contact.request.accept': 'Accepted a contact request',
  'contact.request.decline': 'Declined a contact request',
  'contact.request.cancel': 'Cancelled a contact request',
  'contact.remove': 'Removed a contact',

  'notification.read': 'Marked notifications as read',
  'notification.dismiss': 'Dismissed notifications',
};

function labelForAction(action: string): string {
  const mapped = ACTION_LABELS[action];
  if (mapped) return mapped;
  return humanizeRawAction(action);
}

/**
 * Best-effort humanisation for an unknown action. Turns 'foo.bar_baz' into
 * 'Foo bar baz'. Better than surfacing the raw dotted string, still clearly
 * a fallback so a missing label is visually obvious in review.
 */
function humanizeRawAction(action: string): string {
  const flat = action.replace(/[._]+/g, ' ').trim();
  if (!flat) return action;
  return flat.charAt(0).toUpperCase() + flat.slice(1);
}

function truncateId(id: string): string {
  // First segment of a uuid is enough to eyeball distinct entities without
  // the row looking like a hash dump.
  return id.length > 8 ? id.slice(0, 8) + '…' : id;
}

/**
 * Locale-aware timestamp. Matches the formatter used by notifications-list
 * and home-feed: SSR returns the ISO string to avoid timezone-mismatch
 * warnings; the client upgrades to "Oct 3, 2:14 PM" on hydration.
 */
function formatTimestamp(iso: string): string {
  if (typeof window === 'undefined') return iso;
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
