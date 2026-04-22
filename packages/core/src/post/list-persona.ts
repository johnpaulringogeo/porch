import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona, post, postAudience } from '@porch/db';
import type { Post } from '@porch/types/domain';
import type { CommentSummary, LikeSummary } from '@porch/types/api';
import { PostAudienceMode, PostModerationState } from '@porch/types/domain';
import { toApiPost } from './helpers.js';
import { getLikeSummariesForPosts } from './like.js';
import { getCommentSummariesForPosts } from '../comment/index.js';
import { toPublicPersona } from '../contact/helpers.js';
import { decodeCursor, encodeCursor } from '../feed/index.js';

export interface ListPersonaPostsParams {
  cursor?: string;
  /** Page size. Routes cap at 100; default 50. */
  limit?: number;
}

export interface ListPersonaPostsResult {
  posts: Post[];
  /**
   * Like state per post in this page, keyed by post id. Same shape as
   * ListMyPostsResult — every id in `posts` is present, with unliked posts
   * appearing as `{ liked: false, totalLikes: 0 }`.
   */
  likeSummaries: Record<string, LikeSummary>;
  /**
   * Comment counts per post in this page, keyed by post id. Every id in
   * `posts` has an entry; posts with no comments appear as
   * `{ totalComments: 0 }`.
   */
  commentSummaries: Record<string, CommentSummary>;
  nextCursor: string | null;
}

/**
 * Viewer-scoped list of posts authored by `authorPersonaId`, newest first.
 *
 * Visibility rules match getPost:
 *   - author sees everything non-deleted (including moderated),
 *   - other viewers see only non-deleted posts in {ok, limited} moderation
 *     where the audience rules permit them to read individually.
 *
 * "Can read" splits by audience mode:
 *   all_contacts → the author must own a contact edge to the viewer,
 *   selected     → there must be a post_audience row for (post, viewer).
 *
 * We apply this in SQL rather than filtering in-app so pagination stays
 * O(page), not O(author's lifetime posts). The shared feed cursor codec
 * keeps the client side simple — one "Load more" button, one format.
 */
export async function listPersonaPosts(
  db: Database,
  viewer: { personaId: string },
  authorPersonaId: string,
  params: ListPersonaPostsParams = {},
): Promise<ListPersonaPostsResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const decoded = params.cursor ? decodeCursor(params.cursor) : null;

  const isSelf = viewer.personaId === authorPersonaId;

  const base = and(
    eq(post.authorPersonaId, authorPersonaId),
    isNull(post.deletedAt),
  );

  // For non-author viewers, add the moderation + visibility gate.
  const visibility = isSelf
    ? undefined
    : and(
        or(
          eq(post.moderationState, PostModerationState.Ok),
          eq(post.moderationState, PostModerationState.Limited),
        ),
        or(
          // all_contacts: one edge from author→viewer gates every such post.
          and(
            eq(post.audienceMode, PostAudienceMode.AllContacts),
            sql`exists (
              select 1 from ${contact}
              where ${contact.ownerPersonaId} = ${authorPersonaId}
                and ${contact.contactPersonaId} = ${viewer.personaId}
            )`,
          ),
          // selected: a post_audience row for (this post, viewer).
          and(
            eq(post.audienceMode, PostAudienceMode.Selected),
            sql`exists (
              select 1 from ${postAudience}
              where ${postAudience.postId} = ${post.id}
                and ${postAudience.audiencePersonaId} = ${viewer.personaId}
            )`,
          ),
        ),
      );

  const cursorCond = decoded
    ? or(
        lt(post.createdAt, new Date(decoded.createdAt)),
        and(
          eq(post.createdAt, new Date(decoded.createdAt)),
          lt(post.id, decoded.id),
        ),
      )
    : undefined;

  const where = and(
    ...[base, visibility, cursorCond].filter(
      (c): c is NonNullable<typeof c> => c !== undefined,
    ),
  );

  const rows = await db
    .select()
    .from(post)
    .where(where)
    .orderBy(desc(post.createdAt), desc(post.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (page.length === 0) {
    return {
      posts: [],
      likeSummaries: {},
      commentSummaries: {},
      nextCursor: null,
    };
  }

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, authorPersonaId))
    .limit(1);
  if (!authorRow) {
    // Author vanished between the profile lookup and this call — treat as
    // an empty result rather than 500'ing the page.
    return {
      posts: [],
      likeSummaries: {},
      commentSummaries: {},
      nextCursor: null,
    };
  }
  const author = toPublicPersona(authorRow);

  const last = page[page.length - 1]!;
  const nextCursor = hasMore
    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null;

  const postIds = page.map((row) => row.id);
  const [likeMap, commentMap] = await Promise.all([
    getLikeSummariesForPosts(db, viewer, postIds),
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
