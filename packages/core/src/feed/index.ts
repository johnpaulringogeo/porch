import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { contact, persona, post, postAudience, type Database } from '@porch/db';

export interface FeedCursor {
  createdAt: string; // ISO timestamp
  id: string;
}

export function encodeCursor(c: FeedCursor): string {
  return btoa(JSON.stringify(c));
}

export function decodeCursor(raw: string): FeedCursor | null {
  try {
    const decoded = JSON.parse(atob(raw)) as FeedCursor;
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface HomeFeedParams {
  viewerPersonaId: string;
  limit: number;
  cursor?: FeedCursor;
}

/**
 * Read-fanout Home feed query.
 *
 * For the viewing persona, returns posts where:
 * - author has me as a contact AND audience_mode = 'all_contacts', OR
 * - post_audience includes me AND audience_mode = 'selected'
 *
 * Excludes soft-deleted posts and posts in terminal moderation states.
 * Keyset pagination on (created_at, id) descending.
 */
export async function getHomeFeed(db: Database, params: HomeFeedParams) {
  const { viewerPersonaId, limit } = params;

  const visible = or(
    and(
      eq(post.audienceMode, 'all_contacts'),
      exists(
        db
          .select({ one: sql`1` })
          .from(contact)
          .where(
            and(
              eq(contact.ownerPersonaId, post.authorPersonaId),
              eq(contact.contactPersonaId, viewerPersonaId),
            ),
          ),
      ),
    ),
    and(
      eq(post.audienceMode, 'selected'),
      exists(
        db
          .select({ one: sql`1` })
          .from(postAudience)
          .where(
            and(
              eq(postAudience.postId, post.id),
              eq(postAudience.audiencePersonaId, viewerPersonaId),
            ),
          ),
      ),
    ),
  );

  const baseConditions = and(
    eq(post.mode, 'home'),
    isNull(post.deletedAt),
    inArray(post.moderationState, ['ok', 'limited']),
    visible,
  );

  const conditions = params.cursor
    ? and(
        baseConditions,
        or(
          lt(post.createdAt, new Date(params.cursor.createdAt)),
          and(eq(post.createdAt, new Date(params.cursor.createdAt)), lt(post.id, params.cursor.id)),
        ),
      )
    : baseConditions;

  const rows = await db
    .select({
      post,
      author: {
        id: persona.id,
        username: persona.username,
        did: persona.did,
        displayName: persona.displayName,
        bio: persona.bio,
        avatarUrl: persona.avatarUrl,
      },
    })
    .from(post)
    .innerJoin(persona, eq(persona.id, post.authorPersonaId))
    .where(conditions)
    .orderBy(desc(post.createdAt), desc(post.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({ createdAt: lastItem.post.createdAt.toISOString(), id: lastItem.post.id })
      : null;

  return { items, nextCursor };
}
