import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database, PostComment as PostCommentRow } from '@porch/db';
import { persona, postComment } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { CommentSummary } from '@porch/types/api';
import type { Comment, PublicPersona } from '@porch/types/domain';
import { decodeCursor, encodeCursor } from '../feed/index.js';
import { toPublicPersona } from '../contact/helpers.js';
import { assertCanViewPost } from '../post/helpers.js';
import type { PostActor } from '../post/create.js';

/**
 * Comments on posts — v0 CRUD.
 *
 * Comments share the post's visibility gate: if the viewer can't read the
 * post (audience/moderation/deleted), they can't list or create comments on
 * it. We funnel every entrypoint through `assertCanViewPost` before any
 * comment-specific work, so the comment surface can never be used to
 * probe post existence past what `GET /api/posts/:id` already leaks.
 *
 * Not threaded. No reactions. No rate limiting beyond the server-wide
 * per-route limits. Those get added when the surface is active enough to
 * warrant them.
 *
 * Author-only soft delete: we keep the row around (for moderation review)
 * but drop it from every read surface. The UI today just shows the count
 * decrease and moves on — no "[deleted]" tombstone. If threading ever
 * lands, that decision gets revisited.
 *
 * Cursor codec is the same `(createdAt, id)` shape as the feed + notifications
 * modules so the web client only needs to know one format.
 */

// ── Actor ──────────────────────────────────────────────────────────────────

/**
 * Alias of PostActor — comments live under posts and don't need their own
 * actor shape. Declared here so the public surface reads as "CommentActor"
 * at call sites.
 */
export type CommentActor = PostActor;

// ── Create ─────────────────────────────────────────────────────────────────

export interface CreateCommentInput {
  postId: string;
  content: string;
}

export interface CreateCommentResult {
  comment: Comment;
  commentSummary: CommentSummary;
}

/**
 * Create a comment on behalf of the actor.
 *
 * Visibility: the actor must be able to read the post (goes through
 * `assertCanViewPost`). Self-comments are allowed — unlike self-likes, a
 * "I forgot to add…" follow-up from the author is a legitimate use.
 *
 * Content is trusted as pre-validated by the route (zod caps length at
 * 4000). We still `trim()` server-side so accidental leading/trailing
 * whitespace doesn't create a blank-looking comment.
 */
export async function createComment(
  db: Database,
  actor: CommentActor,
  input: CreateCommentInput,
): Promise<CreateCommentResult> {
  await assertCanViewPost(db, actor, input.postId);

  const trimmed = input.content.trim();
  if (trimmed.length === 0) {
    throw new PorchError(
      ErrorCode.BadRequest,
      'Comment content cannot be empty.',
      'content',
    );
  }

  const [row] = await db
    .insert(postComment)
    .values({
      postId: input.postId,
      authorPersonaId: actor.personaId,
      content: trimmed,
    })
    .returning();
  if (!row) throw new Error('Failed to create comment');

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, actor.personaId))
    .limit(1);
  if (!authorRow) throw new Error('Author persona vanished mid-comment');

  const commentSummary = await getCommentSummary(db, input.postId);

  return {
    comment: toApiComment(row, toPublicPersona(authorRow)),
    commentSummary,
  };
}

// ── List ───────────────────────────────────────────────────────────────────

export interface ListCommentsParams {
  postId: string;
  cursor?: string;
  /** Page size. Routes cap at 100; default 50. */
  limit?: number;
}

export interface ListCommentsResult {
  comments: Comment[];
  commentSummary: CommentSummary;
  nextCursor: string | null;
}

/**
 * Paginated list of non-deleted comments on `postId`, newest first.
 *
 * Visibility check up front: a viewer who can't read the post gets the
 * same 404 they'd get from `GET /api/posts/:id`. We don't return the
 * current count when the viewer is blocked — the thrown error is terminal.
 *
 * Authors are resolved in a single batched join (`IN (…authorIds)`) rather
 * than a per-row lookup. The page cap is 100 so the IN clause size is
 * bounded and predictable.
 */
export async function listComments(
  db: Database,
  actor: CommentActor,
  params: ListCommentsParams,
): Promise<ListCommentsResult> {
  await assertCanViewPost(db, actor, params.postId);

  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const decoded = params.cursor ? decodeCursor(params.cursor) : null;

  const base = and(
    eq(postComment.postId, params.postId),
    isNull(postComment.deletedAt),
  );
  const conditions = decoded
    ? and(
        base,
        or(
          lt(postComment.createdAt, new Date(decoded.createdAt)),
          and(
            eq(postComment.createdAt, new Date(decoded.createdAt)),
            lt(postComment.id, decoded.id),
          ),
        ),
      )
    : base;

  const rows = await db
    .select()
    .from(postComment)
    .where(conditions)
    .orderBy(desc(postComment.createdAt), desc(postComment.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Always report the *total* non-deleted count for the post, not just the
  // count of rows on this page — the UI uses it for the "N comments" badge.
  const commentSummary = await getCommentSummary(db, params.postId);

  if (page.length === 0) {
    return {
      comments: [],
      commentSummary,
      nextCursor: null,
    };
  }

  const authorIds = Array.from(new Set(page.map((row) => row.authorPersonaId)));
  const authors = await db
    .select()
    .from(persona)
    .where(inArray(persona.id, authorIds));
  const authorMap = new Map<string, PublicPersona>();
  for (const p of authors) {
    authorMap.set(p.id, toPublicPersona(p));
  }

  const last = page[page.length - 1]!;
  const nextCursor = hasMore
    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null;

  return {
    comments: page
      .map((row) => {
        const author = authorMap.get(row.authorPersonaId);
        // An author going missing between comment insert and list read would
        // be weird but survivable — skip the row rather than 500ing the page.
        // The count still includes it; callers will see a count mismatch for
        // the ghost row that they can't do anything about anyway.
        return author ? toApiComment(row, author) : null;
      })
      .filter((c): c is Comment => c !== null),
    commentSummary,
    nextCursor,
  };
}

// ── Delete ─────────────────────────────────────────────────────────────────

export interface DeleteCommentInput {
  postId: string;
  commentId: string;
}

export interface DeleteCommentResult {
  commentSummary: CommentSummary;
}

/**
 * Soft delete — sets `deletedAt`. Author-only: anyone else (including the
 * post author, in v0) trying to delete a comment that isn't theirs gets
 * 404, not 403, so the endpoint doesn't leak existence of a comment the
 * caller has no business knowing about.
 *
 * A post author moderating comments on their own post is a feature we may
 * add later (it's the obvious next step). Out of v0 scope — the surface
 * doesn't need it yet and adding it requires a UI for "as post author,
 * delete this comment".
 *
 * Already-deleted comments are also reported as 404 — idempotent from the
 * caller's perspective but a retry doesn't update the timestamp.
 */
export async function deleteComment(
  db: Database,
  actor: CommentActor,
  input: DeleteCommentInput,
): Promise<DeleteCommentResult> {
  const [row] = await db
    .select()
    .from(postComment)
    .where(
      and(
        eq(postComment.id, input.commentId),
        eq(postComment.postId, input.postId),
        isNull(postComment.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PorchError(ErrorCode.NotFound, 'Comment not found.');
  }
  if (row.authorPersonaId !== actor.personaId) {
    // Mask as 404 — see docstring.
    throw new PorchError(ErrorCode.NotFound, 'Comment not found.');
  }

  await db
    .update(postComment)
    .set({ deletedAt: new Date() })
    .where(eq(postComment.id, input.commentId));

  const commentSummary = await getCommentSummary(db, input.postId);
  return { commentSummary };
}

// ── Summaries ──────────────────────────────────────────────────────────────

/**
 * Total non-deleted comment count for one post. Does not require a
 * visibility check — callers that care about access have already gone
 * through `assertCanViewPost` (or are list endpoints that only pass in
 * post IDs they've already filtered).
 */
export async function getCommentSummary(
  db: Database,
  postId: string,
): Promise<CommentSummary> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(postComment)
    .where(and(eq(postComment.postId, postId), isNull(postComment.deletedAt)));
  return { totalComments: row?.total ?? 0 };
}

/**
 * Batch variant for list views. Returns a map keyed by postId with an entry
 * for every input id — posts with zero (or only deleted) comments still get
 * `{ totalComments: 0 }` so callers can render without a coalesce.
 *
 * Empty input is a no-op to avoid `WHERE post_id IN ()` on drivers that
 * reject it. One query regardless of page size — the same shape as
 * `getLikeSummariesForPosts`.
 *
 * No visibility check. Callers (list ops) have already filtered to posts
 * the viewer can see, so the result rows can't leak comment counts for
 * posts the viewer isn't permitted to read.
 */
export async function getCommentSummariesForPosts(
  db: Database,
  postIds: string[],
): Promise<Map<string, CommentSummary>> {
  const summaries = new Map<string, CommentSummary>();
  if (postIds.length === 0) return summaries;

  for (const id of postIds) {
    summaries.set(id, { totalComments: 0 });
  }

  const counts = await db
    .select({
      postId: postComment.postId,
      total: sql<number>`count(*)::int`,
    })
    .from(postComment)
    .where(
      and(
        inArray(postComment.postId, postIds),
        isNull(postComment.deletedAt),
      ),
    )
    .groupBy(postComment.postId);

  for (const row of counts) {
    summaries.set(row.postId, { totalComments: row.total });
  }

  return summaries;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * DB row → API-safe Comment. Soft-deleted rows are not supposed to reach
 * this helper (listComments filters them out). If one does, the consumer
 * will see a normal-looking Comment — we don't surface a tombstone flag in
 * v0 because nothing renders deleted comments.
 */
export function toApiComment(row: PostCommentRow, author: PublicPersona): Comment {
  return {
    id: row.id,
    postId: row.postId,
    author,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  };
}
