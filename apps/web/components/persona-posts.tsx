'use client';

/**
 * Viewer-scoped post list for one persona — the "Posts" section on a
 * profile page. Same keyset-cursor walking pattern as <HomeFeed> and
 * <MyPosts>; different endpoint (/api/personas/:username/posts) and no
 * top-level "feed" chrome around it.
 *
 * We don't render the author in each row: every row has the same author
 * (the profile owner), and the profile header already says who they are.
 * Dropping that line keeps the list scanning cleanly.
 *
 * When the list comes back empty we show a tailored empty state — for the
 * self-viewer we hint at composing; for others we say "nothing visible yet"
 * since there's no way to tell whether the profile has no posts at all or
 * just none the viewer is permitted to see.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ListPersonaPostsResponse } from '@porch/types/api';
import type { Post } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface PersonaPostsProps {
  username: string;
  /** True when the viewer is the profile owner — changes empty copy. */
  isSelf: boolean;
}

export function PersonaPosts({ username, isSelf }: PersonaPostsProps) {
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListPersonaPostsResponse>({
          path: `/api/personas/${encodeURIComponent(username)}/posts`,
          accessToken,
          signal,
        });
        setPosts(res.posts);
        setCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError ? err.message : 'Could not load posts.',
        );
      }
    },
    [accessToken, username],
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
      const res = await api<ListPersonaPostsResponse>({
        path: `/api/personas/${encodeURIComponent(username)}/posts?cursor=${encodeURIComponent(cursor)}`,
        accessToken,
      });
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
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading posts…</p>
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
        {isSelf
          ? "You haven't posted anything yet. Head to Home to compose your first post."
          : "Nothing visible yet. If you're not mutual contacts, you may not be able to see their posts."}
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
            <p className="whitespace-pre-wrap text-sm">{post.content}</p>
            <footer className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
              <time dateTime={post.createdAt}>
                {formatTimestamp(post.createdAt)}
              </time>
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
          End of posts.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Short, locale-aware timestamp. Same helper lives in home-feed /
 * my-posts / notifications-list — kept duplicated until the fourth use
 * lands, at which point it's clearly earned a @/lib home.
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
