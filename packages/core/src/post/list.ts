import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona, post } from '@porch/db';
import type { Post } from '@porch/types/domain';
import { toApiPost } from './helpers.js';
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
    return { posts: [], nextCursor: null };
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

  return {
    posts: page.map((row) => toApiPost(row, author)),
    nextCursor,
  };
}
