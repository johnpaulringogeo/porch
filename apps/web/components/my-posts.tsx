'use client';

/**
 * Actor's own recent posts. Newest-first list with a delete button per post
 * and a "Load more" button that walks the keyset cursor returned by the API
 * (`nextCursor === null` ⇒ end). Same pattern as <HomeFeed> and
 * <PersonaPosts> so the three list views behave identically.
 *
 * Re-fetches when `refreshKey` changes — the dashboard bumps it after a
 * successful compose. That reset clears the cursor and replaces the list,
 * which is what we want: a brand-new post belongs at the top of page 1, not
 * appended to whatever later page the user happens to be on.
 *
 * Like affordance: always read-only <LikeCount>. These are the viewer's own
 * posts and the API rejects self-likes — an interactive button that can
 * only error is worse than no button.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  CommentSummary,
  LikeSummary,
  ListMyPostsResponse,
} from '@porch/types/api';
import type { Post } from '@porch/types/domain';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTimestamp } from '@/lib/format-time';
import { LikeCount } from '@/components/like-pill';
import { CommentCount } from '@/components/comment-pill';
import { PostContent } from '@/components/post-content';
import { ModeratedPostBody } from '@/components/moderated-post-body';

interface MyPostsProps {
  refreshKey: number;
}

export function MyPosts({ refreshKey }: MyPostsProps) {
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [likeSummaries, setLikeSummaries] = useState<
    Record<string, LikeSummary>
  >({});
  const [commentSummaries, setCommentSummaries] = useState<
    Record<string, CommentSummary>
  >({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await api<ListMyPostsResponse>({
          path: '/api/posts/mine',
          accessToken,
          signal,
        });
        setPosts(res.posts);
        setLikeSummaries(res.likeSummaries);
        setCommentSummaries(res.commentSummaries);
        setCursor(res.nextCursor);
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
    void loadInitial(ctrl.signal);
    return () => ctrl.abort();
  }, [loadInitial, refreshKey]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api<ListMyPostsResponse>({
        path: `/api/posts/mine?cursor=${encodeURIComponent(cursor)}`,
        accessToken,
      });
      setPosts((curr) => (curr ? [...curr, ...res.posts] : res.posts));
      // Merge new summaries onto the existing maps so earlier-page counts
      // stay around. Page boundaries are by created-at, not id, so there's
      // no overlap for keys to collide on.
      setLikeSummaries((curr) => ({ ...curr, ...res.likeSummaries }));
      setCommentSummaries((curr) => ({ ...curr, ...res.commentSummaries }));
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
  if (error && posts === null) {
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
    <div className="space-y-4">
      <ul className="space-y-3">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {/*
                  This list is the viewer's own posts by definition — the
                  /api/posts/mine endpoint scopes by the active persona.
                  So isAuthor is always true and ModeratedPostBody will
                  render the content with a banner above when moderation
                  state is non-ok.
                */}
                <ModeratedPostBody post={post} isAuthor>
                  <PostContent
                    content={post.content}
                    className="whitespace-pre-wrap text-sm"
                  />
                </ModeratedPostBody>
                <p className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--text-muted))]">
                  <Link
                    href={`/p/${post.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    <time dateTime={post.createdAt}>
                      {formatTimestamp(post.createdAt)}
                    </time>
                  </Link>
                  {post.editedAt ? <span>· edited</span> : null}
                  {post.audienceMode === 'selected' ? (
                    <span className="rounded-full bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-[hsl(var(--border-default))]">
                      selected
                    </span>
                  ) : null}
                  {post.moderationState !== 'ok' ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                      {post.moderationState.replace('_', ' ')}
                    </span>
                  ) : null}
                  <LikeCount summary={likeSummaries[post.id]} />
                  <CommentCount
                    postId={post.id}
                    summary={commentSummaries[post.id]}
                  />
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

      {/* Error from a failed delete or "Load more" while we still have earlier posts. */}
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
