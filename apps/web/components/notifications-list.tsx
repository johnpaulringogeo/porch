'use client';

/**
 * Notifications list.
 *
 * Data flow:
 *   1. On mount: GET /api/notifications (first page). Seed `unreadCount`
 *      from the response so the header badge and this page start coherent.
 *   2. Immediately after: POST /api/notifications/read with the unread IDs
 *      visible on the page. The server returns the new unreadCount which we
 *      push into context. Rows stay visible but styled as read — this is a
 *      "notification tray", not an inbox, so a read row doesn't disappear.
 *   3. Per-row Dismiss: POST /dismiss with that id; drop the row locally.
 *   4. "Mark all read": POST /read with `{ all: true }`. Rewrites every
 *      loaded row's readAt client-side and resets unreadCount to 0.
 *   5. Load more: walk `nextCursor` the same way home-feed does.
 *
 * Per-row mutations keep a `pendingIds` Set so buttons disable while the
 * request is in flight — mirrors the pattern in incoming-requests.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  type ApiNotification,
  type ListNotificationsResponse,
  type NotificationWriteResponse,
} from '@porch/types/api';
import { NotificationType } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { UsernameLink } from '@/components/username-link';

export function NotificationsList() {
  const { accessToken } = useAuth();
  const { setUnreadCount } = useNotifications();

  const [notifications, setNotifications] = useState<ApiNotification[] | null>(
    null,
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);

  // Guards against double-marking when the effect re-runs (React 18 strict
  // mode in dev, or accessToken identity-churn).
  const markedOnceRef = useRef(false);

  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListNotificationsResponse>({
          path: '/api/notifications?limit=50',
          accessToken,
          signal,
        });
        setNotifications(res.notifications);
        setCursor(res.nextCursor);
        setUnreadCount(res.unreadCount);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your notifications.',
        );
      }
    },
    [accessToken, setUnreadCount],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadInitial(ctrl.signal);
    return () => ctrl.abort();
  }, [loadInitial]);

  // Mark-read-on-view: once the first page is in, flip any unread rows. We
  // only do this on the *initial* load to avoid re-marking when the user
  // paginates (the later pages are older, already-read rows in the common
  // case). If a newly-fetched "Load more" page happens to contain unreads,
  // they'll be cleared when the user next visits the page.
  useEffect(() => {
    if (markedOnceRef.current) return;
    if (!notifications) return;
    const unreadIds = notifications
      .filter((n) => n.readAt === null && n.dismissedAt === null)
      .map((n) => n.id);
    if (unreadIds.length === 0) {
      markedOnceRef.current = true;
      return;
    }
    markedOnceRef.current = true;
    void (async () => {
      try {
        const res = await api<NotificationWriteResponse>({
          method: 'POST',
          path: '/api/notifications/read',
          body: { ids: unreadIds },
          accessToken,
        });
        const now = new Date().toISOString();
        setNotifications((curr) =>
          curr
            ? curr.map((n) =>
                unreadIds.includes(n.id) ? { ...n, readAt: now } : n,
              )
            : curr,
        );
        setUnreadCount(res.unreadCount);
      } catch (err) {
        // Non-fatal — the user will see the rows regardless; the badge just
        // won't clear. Next visit will try again.
        console.error('notifications-mark-read-on-view-failed', err);
      }
    })();
  }, [notifications, accessToken, setUnreadCount]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api<ListNotificationsResponse>({
        path: `/api/notifications?limit=50&cursor=${encodeURIComponent(cursor)}`,
        accessToken,
      });
      setNotifications((curr) =>
        curr ? [...curr, ...res.notifications] : res.notifications,
      );
      setCursor(res.nextCursor);
      // Keep the context badge fresh — the count doesn't change on a pure
      // read, but the server returns the current value so we may as well.
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load more notifications.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function dismissOne(id: string) {
    setPendingIds((curr) => {
      const next = new Set(curr);
      next.add(id);
      return next;
    });
    try {
      const res = await api<NotificationWriteResponse>({
        method: 'POST',
        path: '/api/notifications/dismiss',
        body: { ids: [id] },
        accessToken,
      });
      setNotifications((curr) => (curr ? curr.filter((n) => n.id !== id) : curr));
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not dismiss notification.',
      );
    } finally {
      setPendingIds((curr) => {
        const next = new Set(curr);
        next.delete(id);
        return next;
      });
    }
  }

  async function markAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    setError(null);
    try {
      const res = await api<NotificationWriteResponse>({
        method: 'POST',
        path: '/api/notifications/read',
        body: { all: true },
        accessToken,
      });
      const now = new Date().toISOString();
      setNotifications((curr) =>
        curr
          ? curr.map((n) => (n.readAt === null ? { ...n, readAt: now } : n))
          : curr,
      );
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not mark all as read.',
      );
    } finally {
      setMarkingAll(false);
    }
  }

  if (notifications === null && error === null) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">
        Loading notifications…
      </p>
    );
  }
  if (error && notifications === null) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (!notifications || notifications.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-6 text-sm text-[hsl(var(--text-muted))]">
        No notifications yet. Contact requests, accepted contacts, and posts
        someone shares directly with you will show up here.
      </div>
    );
  }

  const hasUnread = notifications.some(
    (n) => n.readAt === null && n.dismissedAt === null,
  );

  return (
    <div className="space-y-4">
      {hasUnread ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={markingAll}
            className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-1 text-xs font-medium text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {notifications.map((n) => {
          const unread = n.readAt === null;
          const pending = pendingIds.has(n.id);
          return (
            <li
              key={n.id}
              className={
                unread
                  ? 'flex items-start gap-3 rounded-lg border border-[hsl(var(--border-default))] bg-mode-home-surface/30 p-4'
                  : 'flex items-start gap-3 rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-4'
              }
            >
              {unread ? (
                <span
                  aria-label="Unread"
                  className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full bg-mode-home"
                />
              ) : (
                <span aria-hidden className="mt-1.5 inline-block h-2 w-2 flex-none" />
              )}

              <div className="flex-1 text-sm">
                <NotificationBody notification={n} />
                <time
                  dateTime={n.createdAt}
                  className="mt-1 block text-xs text-[hsl(var(--text-muted))]"
                >
                  {formatTimestamp(n.createdAt)}
                </time>
              </div>

              <button
                type="button"
                onClick={() => void dismissOne(n.id)}
                disabled={pending}
                className="flex-none rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-2.5 py-1 text-xs text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Dismissing…' : 'Dismiss'}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Error from a write/loadMore that happened while rows are visible. */}
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
      ) : notifications.length > 0 ? (
        <p className="pt-2 text-center text-xs text-[hsl(var(--text-muted))]">
          You&apos;re all caught up.
        </p>
      ) : null}
    </div>
  );
}

// ── Type-specific copy ────────────────────────────────────────────────────

/**
 * Render one notification's body. Split out so the switch stays tidy — and
 * adding a new NotificationType is a single case here.
 *
 * When `actor` is null (deleted persona, or a type that doesn't reference
 * one) we fall back to a generic "Someone" phrasing rather than showing a
 * blank @-handle.
 */
function NotificationBody({ notification: n }: { notification: ApiNotification }) {
  // When we have an actor, render their handle as a link to their profile.
  // When we don't (null actor / non-actor types), keep the "Someone" copy —
  // UsernameLink would otherwise point at a dead profile.
  const actorEl = n.actor ? (
    <UsernameLink
      username={n.actor.username}
      className="font-medium underline-offset-2 hover:underline"
    />
  ) : (
    <strong className="font-medium">Someone</strong>
  );

  switch (n.type) {
    case NotificationType.ContactRequestReceived:
      return (
        <p>
          {actorEl} sent you a contact request.{' '}
          <Link
            href="/contacts"
            className="text-mode-home underline-offset-2 hover:underline"
          >
            Review
          </Link>
        </p>
      );
    case NotificationType.ContactRequestAccepted:
      return (
        <p>
          {actorEl} accepted your contact request.{' '}
          <Link
            href="/contacts"
            className="text-mode-home underline-offset-2 hover:underline"
          >
            View contacts
          </Link>
        </p>
      );
    case NotificationType.ContactRequestDeclined:
      // No destination — just surface the fact; the contact bundle UI already
      // reflects the state. Kept terse intentionally.
      return <p>{actorEl} declined your contact request.</p>;
    case NotificationType.PostSelectedAudience: {
      // Deep-link to the post. The visibility check on the post page will let
      // the recipient through — they're in the audience by construction. If
      // the author has since deleted the post or removed them, the page
      // itself surfaces a 404 / not-permitted state; we keep this row honest
      // by still linking and letting the destination explain.
      const postId =
        typeof n.payload?.postId === 'string' ? n.payload.postId : null;
      return (
        <p>
          {actorEl} shared a post with you.{' '}
          {postId ? (
            <Link
              href={`/p/${postId}`}
              className="text-mode-home underline-offset-2 hover:underline"
            >
              View
            </Link>
          ) : null}
        </p>
      );
    }
    case NotificationType.PostModerated:
      return (
        <p>
          One of your posts was limited by moderation. It&apos;s still visible
          to you but hidden from feeds.
        </p>
      );
    case NotificationType.AccountModerated:
      return (
        <p>
          Your account state changed due to moderation. Check your email for
          details.
        </p>
      );
    case NotificationType.System:
    default:
      // Generic fallback — render a `title` from the payload if present,
      // otherwise a neutral line. Keeps unknown future types from looking
      // broken in older UI.
      {
        const title =
          typeof n.payload?.title === 'string' ? n.payload.title : null;
        return <p>{title ?? 'You have a new notification.'}</p>;
      }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Same short timestamp style as home-feed.tsx / my-posts.tsx. Third use of
 * this helper — next time it grows, lift to @/lib/format.
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
