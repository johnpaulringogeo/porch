'use client';

/**
 * Home feed — read-fanout over posts the viewer is a permitted audience of.
 * Shows author + content + relative-ish timestamp; a "Load more" button
 * walks the keyset cursor returned by the API (`nextCursor === null` ⇒ end).
 *
 * We keep pagination client-local rather than route-backed because the feed
 * is an inherently ephemeral view — deep-linking page 7 is not interesting,
 * and avoiding URL-sync keeps back/forward nav cheap.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HomeFeedResponse } from '@porch/types/api';
import type { Post } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export function HomeFeed() {
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<HomeFeedResponse>({
          path: '/api/feed/home',
          accessToken,
          signal,
        });
        setPosts(res.posts);
        setCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError ? err.message : 'Could not load your feed.',
        );
      }
    },
    [accessToken],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadInitial(ctrl.signal);
    return () => ctrl.abort();
  }, [loadInitial]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api<HomeFeedResponse>({
        path: `/api/feed/home?cursor=${encodeURIComponent(cursor)}`,
        accessToken,
      });
      // Append, not replace. If the server returns no posts we still advance
      // the cursor to null so the button disappears.
      setPosts((curr) => (curr ? [...curr, ...res.posts] : res.posts));
      setCursor(res.nextCursor);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load more posts.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (posts === null && error === null) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading your feed…</p>
    );
  }
  if (error && posts === null) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (!posts || posts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-6 text-sm text-[hsl(var(--text-muted))]">
        Nothing here yet. When people you&apos;re mutual contacts with post to
        Home mode, their posts will show up here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-4"
          >
            <header className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">
                {post.author.displayName}
              </span>
              <span className="text-xs text-[hsl(var(--text-muted))]">
                @{post.author.username}
              </span>
            </header>
            <p className="mt-2 whitespace-pre-wrap text-sm">{post.content}</p>
            <footer className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
              <time dateTime={post.createdAt}>{formatTimestamp(post.createdAt)}</time>
              {post.editedAt ? <span>· edited</span> : null}
              {post.moderationState === 'limited' ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                  limited
                </span>
              ) : null}
            </footer>
          </li>
        ))}
      </ul>

      {/* Error from a failed "Load more" while we still have earlier posts. */}
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
      ) : posts.length > 0 ? (
        <p className="pt-2 text-center text-xs text-[hsl(var(--text-muted))]">
          You&apos;re all caught up.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Short, locale-aware timestamp. Mirrors the helper in my-posts.tsx —
 * duplicated for now; when a third post view lands we'll lift it into
 * @/lib.
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
