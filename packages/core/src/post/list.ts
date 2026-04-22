import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona, post } from '@porch/db';
import type { Post } from '@porch/types/domain';
import type { CommentSummary, LikeSummary } from '@porch/types/api';
import { toApiPost } from './helpers.js';
import { getLikeSummariesForPosts } from './like.js';
import { getCommentSummariesForPosts } from '../comment/index.js';
import { toPublicPersona } from '../contact/helpers.js';
import { decodeCursor, encodeCursor } from '../feed/index.js';
import type { PostActor } from './create.js';

export interface ListMyPostsParams {
  /** Opaque cursor from a prior page. Undefined = start from newest. */
  cursor?: string;
  /** Page size. Routes cap this at 100; default 50. */
  limit?: number;
}

export interface ListMyPostsResult {
  posts: Post[];
  /**
   * Like state per post in this page, keyed by post id. Every id in `posts`
   * has an entry — unliked posts appear as `{ liked: false, totalLikes: 0 }`.
   */
  likeSummaries: Record<string, LikeSummary>;
  /**
   * Comment counts per post in this page, keyed by post id. Every id in
   * `posts` has an entry; posts with no comments appear as
   * `{ totalComments: 0 }`. Parallel to `likeSummaries` so the UI's lookup
   * pattern is identical for both.
   */
  commentSummaries: Record<string, CommentSummary>;
  nextCursor: string | null;
}

/**
 * List the actor's own posts, newest first, with keyset pagination on
 * (`createdAt`, `id`). Soft-deleted posts are omitted; moderation state is
 * not filtered here — the author should see their own moderated content.
 *
 * Reuses the feed module's cursor codec so client/server share one format.
 */
export async function listMyPosts(
  db: Database,
  actor: PostActor,
  params: ListMyPostsParams = {},
): Promise<ListMyPostsResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const decoded = params.cursor ? decodeCursor(params.cursor) : null;

  const base = and(eq(post.authorPersonaId, actor.personaId), isNull(post.deletedAt));
  const conditions = decoded
    ? and(
        base,
        or(
          lt(post.createdAt, new Date(decoded.createdAt)),
          and(eq(post.createdAt, new Date(decoded.createdAt)), lt(post.id, decoded.id)),
        ),
      )
    : base;

  const rows = await db
    .select()
    .from(post)
    .where(conditions)
    .orderBy(desc(post.createdAt), desc(post.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (page.length === 0) {
    return { posts: [], likeSummaries: {}, commentSummaries: {}, nextCursor: null };
  }

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, actor.personaId))
    .limit(1);
  if (!authorRow) throw new Error('Actor persona missing');
  const author = toPublicPersona(authorRow);

  const last = page[page.length - 1]!;
  const nextCursor = hasMore
    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null;

  const postIds = page.map((row) => row.id);
  // Fetch like + comment summaries in parallel — both are independent read
  // queries keyed on the same page of post ids.
  const [likeMap, commentMap] = await Promise.all([
    getLikeSummariesForPosts(db, actor, postIds),
    getCommentSummariesForPosts(db, postIds),
  ]);
  const likeSummaries = Object.fromEntries(likeMap);
  const commentSummaries = Object.fromEntries(commentMap);

  return {
    posts: page.map((row) => toApiPost(row, author)),
    likeSummaries,
    commentSummaries,
    nextCursor,
  };
}
