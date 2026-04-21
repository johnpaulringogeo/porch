'use client';

/**
 * Actor's own recent posts. v0 renders a simple newest-first list with a
 * delete button per post. Pagination is not surfaced yet — we only show the
 * first page. When we need it, the API already returns `nextCursor`.
 *
 * Re-fetches when `refreshKey` changes. The dashboard bumps the key after a
 * successful compose, which is cheaper than prepending optimistically and
 * then reconciling on error.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Post } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface MyPostsProps {
  refreshKey: number;
}

interface ListMyPostsResponse {
  posts: Post[];
  nextCursor: string | null;
}

export function MyPosts({ refreshKey }: MyPostsProps) {
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListMyPostsResponse>({
          path: '/api/posts/mine',
          accessToken,
          signal,
        });
        setPosts(res.posts);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your posts.',
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

  async function handleDelete(postId: string) {
    try {
      await api<void>({
        method: 'DELETE',
        path: `/api/posts/${postId}`,
        accessToken,
      });
      setPosts((current) => (current ? current.filter((p) => p.id !== postId) : current));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not delete that post.',
      );
    }
  }

  if (posts === null && error === null) {
    return (
      <p className="text-xs text-[hsl(var(--text-muted))]">Loading your posts…</p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (!posts || posts.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--text-muted))]">
        You haven&apos;t posted anything yet. Try the compose box above.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {posts.map((post) => (
        <li
          key={post.id}
          className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm">{post.content}</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
                <time dateTime={post.createdAt}>{formatTimestamp(post.createdAt)}</time>
                {post.editedAt ? <span>· edited</span> : null}
                {post.moderationState !== 'ok' ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                    {post.moderationState.replace('_', ' ')}
                  </span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleDelete(post.id)}
              className="shrink-0 rounded-md border border-[hsl(var(--border-default))] px-2 py-1 text-xs text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface-muted))]"
              aria-label="Delete post"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Short, locale-aware timestamp. SSR renders the ISO; client upgrades to the
 * user's locale. We accept the hydration flash — a brief ISO is less bad than
 * shipping an i18n lib for one label.
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
