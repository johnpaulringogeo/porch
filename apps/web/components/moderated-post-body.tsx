'use client';

/**
 * Renders a post body with v0-spec moderation affordances applied (spec §18.8).
 *
 * Decision tree:
 *
 *   moderationState === 'ok'        → render children normally
 *   isAuthor === true               → render children + a banner explaining
 *                                     the current moderation state (authors
 *                                     always see their own content — they
 *                                     need to know *what* was moderated)
 *   isAuthor === false, non-ok:
 *     'limited'       → replacement block with a reveal button; reason is
 *                       shown inline, body becomes visible once clicked
 *     'hidden'        → replacement block "Post hidden by Porch. Appeal.",
 *                       no reveal (this is the "Porch acted, no second
 *                       guessing in-thread" state)
 *     'removed'       → replacement block "Post removed by Porch. Appeal.",
 *                       no reveal. The API normally 404s removed posts to
 *                       non-authors, but we handle this branch defensively
 *                       in case a list surface ever exposes one by accident
 *     'pending_review'→ render children (behaves like 'ok' to non-authors
 *                       so the triage queue is invisible). Matches the spec
 *                       filter on feed / profile list SQL which already
 *                       includes pending_review alongside ok for read paths.
 *
 * The reveal state is intentionally ephemeral — a full page reload starts
 * re-hidden. Persisting a "I revealed this" decision across sessions would
 * defeat the point: the moderation UX is meant to make the viewer opt in
 * every time they encounter the content.
 *
 * The appeal link points at a mailto: today because the appeal flow itself
 * isn't in v0 (spec §18.8 only describes the viewer-side copy). A dedicated
 * `/appeals/<post-id>` route would be a natural v0.5 addition; until then
 * mailto preserves the affordance without faking a form that doesn't exist.
 */

import { useState, type ReactNode } from 'react';
import type { Post } from '@porch/types/domain';

export interface ModeratedPostBodyProps {
  post: Post;
  isAuthor: boolean;
  /**
   * The normal content render (typically `<PostContent ... />`). Shown when
   * moderation is 'ok', when the viewer is the author, or when the viewer
   * has clicked "Reveal" on a limited post.
   */
  children: ReactNode;
}

export function ModeratedPostBody({
  post,
  isAuthor,
  children,
}: ModeratedPostBodyProps) {
  const [revealed, setRevealed] = useState(false);

  const state = post.moderationState;

  // Happy path: no moderation, show the body as-is.
  if (state === 'ok') return <>{children}</>;

  // Authors always see their own content. A banner sits above it explaining
  // what happened — crucial for the "my post just disappeared from feeds"
  // case, and it doubles as the place we'd put an appeal CTA in v0.5.
  if (isAuthor) {
    return (
      <div className="space-y-2">
        <AuthorModerationBanner
          state={state}
          reason={post.moderationReason}
          postId={post.id}
        />
        {children}
      </div>
    );
  }

  // Non-authors. `pending_review` is treated as "fine to display" — the
  // review queue is internal state, not something a reader should be aware
  // of. Feed/profile SQL already filters out the loud states (hidden /
  // removed) for non-authors, so the rest of this switch is defence-in-
  // depth for list surfaces that don't apply that filter (e.g., a future
  // search view) plus the detail page.
  if (state === 'pending_review') return <>{children}</>;

  if (state === 'limited') {
    if (revealed) {
      return (
        <div className="space-y-2">
          <p className="text-xs text-amber-800">
            Revealed limited content.{' '}
            <button
              type="button"
              onClick={() => setRevealed(false)}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Hide again
            </button>
          </p>
          {children}
        </div>
      );
    }

    return (
      <ReplacementBlock>
        <p className="text-sm text-amber-900">
          This post is limited
          {post.moderationReason ? (
            <>
              {' '}
              because: <em>{post.moderationReason}</em>
            </>
          ) : (
            '.'
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            aria-label={
              post.moderationReason
                ? `Reveal limited post: ${post.moderationReason}`
                : 'Reveal limited post'
            }
            className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Reveal
          </button>
          <AppealLink postId={post.id} />
        </div>
      </ReplacementBlock>
    );
  }

  if (state === 'hidden') {
    return (
      <ReplacementBlock>
        <p className="text-sm text-amber-900">Post hidden by Porch.</p>
        <div className="mt-2">
          <AppealLink postId={post.id} />
        </div>
      </ReplacementBlock>
    );
  }

  // state === 'removed'
  return (
    <ReplacementBlock>
      <p className="text-sm text-amber-900">Post removed by Porch.</p>
      <div className="mt-2">
        <AppealLink postId={post.id} />
      </div>
    </ReplacementBlock>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function ReplacementBlock({ children }: { children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Moderated post"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
    >
      {children}
    </div>
  );
}

function AuthorModerationBanner({
  state,
  reason,
  postId,
}: {
  state: Post['moderationState'];
  reason: string | null;
  postId: string;
}) {
  const label =
    state === 'limited'
      ? 'Porch has limited this post.'
      : state === 'hidden'
        ? 'Porch has hidden this post from other viewers.'
        : state === 'removed'
          ? 'Porch has removed this post.'
          : state === 'pending_review'
            ? 'This post is under review.'
            : 'This post has a moderation state set.';

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-medium">{label}</p>
      {reason ? <p className="mt-1">Reason: {reason}</p> : null}
      {state !== 'pending_review' ? (
        <p className="mt-1">
          <AppealLink postId={postId} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * Appeal CTA. See module-level comment — this is a mailto placeholder until
 * the appeal route ships in v0.5. The `subject` carries the post id so the
 * trust-and-safety inbox can look the thread up without asking.
 */
function AppealLink({ postId }: { postId: string }) {
  const href = `mailto:trust-and-safety@porch.example?subject=${encodeURIComponent(
    `Appeal moderation on post ${postId}`,
  )}`;
  return (
    <a
      href={href}
      className="text-xs font-medium text-amber-900 underline underline-offset-2 hover:no-underline"
    >
      Appeal
    </a>
  );
}
