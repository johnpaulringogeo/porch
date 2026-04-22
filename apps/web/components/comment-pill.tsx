'use client';

/**
 * Shared comment-count surface for post list rows.
 *
 * Read-only only — unlike likes, there's no one-click "comment" action from a
 * list row; the composer lives on the post detail page. A list-row pill that
 * merely *links* to the post detail (where the composer is) is the simpler
 * thing to ship, and keeps parity with `<LikeCount>` in `like-pill.tsx` for
 * the zero-state rendering rule.
 *
 * Rules:
 *   - Renders nothing when `totalComments === 0`. Most v0 posts will be at
 *     zero and a "0 comments" chip on every row is noise.
 *   - Defensive: a missing summary (shouldn't happen — the API guarantees an
 *     entry for every post id in list responses) is treated the same as zero.
 *
 * The pill wraps `<Link>` so the hit target is the pill itself, not just the
 * text. Navigation to `/p/{postId}` takes the user to the comments section
 * where they can read or add. We deliberately don't auto-scroll or deep-link
 * to `#comments` yet — the page is short enough that the bar is visible on
 * first paint. Easy to add once the page grows.
 */

import Link from 'next/link';
import type { CommentSummary } from '@porch/types/api';

interface CommentCountProps {
  postId: string;
  summary: CommentSummary | undefined;
}

export function CommentCount({ postId, summary }: CommentCountProps) {
  if (!summary || summary.totalComments === 0) return null;
  const label = `${summary.totalComments} ${summary.totalComments === 1 ? 'comment' : 'comments'}`;
  return (
    <Link
      href={`/p/${encodeURIComponent(postId)}`}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--text-default))] underline-offset-2 hover:underline"
    >
      <span aria-hidden="true">💬</span>
      <span>{summary.totalComments}</span>
    </Link>
  );
}
