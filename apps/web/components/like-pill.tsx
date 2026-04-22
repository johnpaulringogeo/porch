'use client';

/**
 * Shared like surfaces for post list rows.
 *
 * Two flavors:
 *
 *   <LikeCount />        — read-only "♥ N" pill. Renders nothing when N is 0.
 *                          Used for rows the viewer can't like (own posts in
 *                          MyPosts, and PersonaPosts when viewing self).
 *   <InlineLikeButton /> — interactive variant. Optimistic toggle, same flow
 *                          as <LikeBar> on /p/[postId]: flip + adjust count,
 *                          POST, replace with server response on success or
 *                          revert on failure. Used in HomeFeed (never own
 *                          posts) and PersonaPosts (when viewing someone
 *                          else's profile).
 *
 * Lifted out of the per-list components instead of duplicated because the
 * interactive variant carries non-trivial state + an API call — three near-
 * identical copies would drift. The trivial display-only LikeCount lives
 * here too so callers only import from one place.
 *
 * Both components own their post-mount state — `initial` seeds them once and
 * subsequent state is sourced from the server response. A parent re-render
 * with an updated `initial` won't clobber an in-flight optimistic update,
 * which matches list-pagination behavior (keyset cursors don't re-issue
 * existing rows).
 */

import { useCallback, useState } from 'react';
import type { LikePostResponse, LikeSummary } from '@porch/types/api';
import { api, ApiError } from '@/lib/api';

interface LikeCountProps {
  summary: LikeSummary | undefined;
}

/**
 * Read-only "♥ N" pill. Renders nothing when totalLikes is 0 — most v0
 * posts will be at zero and a "0 likes" label on every row is noise.
 *
 * Defensive: a missing summary (shouldn't happen — the API guarantees an
 * entry for every post id in list responses) is treated the same as zero.
 */
export function LikeCount({ summary }: LikeCountProps) {
  if (!summary || summary.totalLikes === 0) return null;
  return (
    <span
      aria-label={`${summary.totalLikes} ${summary.totalLikes === 1 ? 'like' : 'likes'}`}
      className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--text-default))]"
    >
      <span aria-hidden="true">♥</span>
      <span>{summary.totalLikes}</span>
    </span>
  );
}

interface InlineLikeButtonProps {
  postId: string;
  /** Seed state from the list response. Local state is authoritative after mount. */
  initial: LikeSummary;
  accessToken: string | null;
}

/**
 * Interactive heart pill for list-row footers.
 *
 * Visual states:
 *   - Unliked: outlined heart, default surface tint, no count when 0.
 *   - Liked: filled heart, red tint, count to the right of the glyph.
 *   - Pending: disabled + dimmed; click intent is consumed locally.
 *
 * Errors revert the optimistic state and surface as a `title` tooltip on
 * the button. We deliberately don't render an inline error string — list
 * rows are space-constrained and the user can always click through to the
 * post detail page where <LikeBar> shows verbose error feedback.
 *
 * The button is rendered inside an <li> that may itself be wrapped in
 * other interactive elements (timestamp link, etc.). We stop click
 * propagation to keep the like action self-contained — nothing in the
 * row should swallow a like click and nothing a like click does should
 * navigate the user away.
 */
export function InlineLikeButton({
  postId,
  initial,
  accessToken,
}: InlineLikeButtonProps) {
  const [summary, setSummary] = useState<LikeSummary>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (pending) return;
      const previous = summary;
      const optimistic: LikeSummary = {
        liked: !previous.liked,
        totalLikes: previous.totalLikes + (previous.liked ? -1 : 1),
      };
      setSummary(optimistic);
      setPending(true);
      setError(null);
      try {
        const res = await api<LikePostResponse>({
          method: 'POST',
          path: `/api/posts/${encodeURIComponent(postId)}/like`,
          accessToken,
        });
        setSummary(res.likeSummary);
      } catch (err) {
        setSummary(previous);
        setError(
          err instanceof ApiError ? err.message : 'Could not update your like.',
        );
      } finally {
        setPending(false);
      }
    },
    [accessToken, pending, postId, summary],
  );

  const liked = summary.liked;
  const showCount = summary.totalLikes > 0;
  const countLabel = `${summary.totalLikes} ${summary.totalLikes === 1 ? 'like' : 'likes'}`;

  const baseClasses =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';
  const stateClasses = liked
    ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100'
    : 'bg-[hsl(var(--surface-muted))] text-[hsl(var(--text-default))] hover:bg-[hsl(var(--surface-default))] ring-1 ring-[hsl(var(--border-default))]';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? `Unlike — ${countLabel}` : `Like — ${countLabel}`}
      title={error ?? undefined}
      className={`${baseClasses} ${stateClasses}`}
    >
      <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
      {showCount ? <span>{summary.totalLikes}</span> : null}
    </button>
  );
}
