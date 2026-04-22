import { and, eq } from 'drizzle-orm';
import type { Database, Post as PostRow } from '@porch/db';
import { contact, post, postAudience } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import {
  PostAudienceMode,
  PostModerationState,
  type Post,
  type PostMode,
  type PublicPersona,
} from '@porch/types/domain';
import type { PostActor } from './create.js';

/**
 * Map a DB post row + its resolved author into the API `Post` shape.
 *
 * Drops author lookup/joining concerns — callers are expected to have already
 * materialized the author as a `PublicPersona`. Moderation reason is surfaced
 * here; routes decide whether to redact it for non-author viewers (in v0 we
 * just leak it uniformly; trust & safety will tighten this).
 */
export function toApiPost(row: PostRow, author: PublicPersona): Post {
  return {
    id: row.id,
    author,
    mode: row.mode as PostMode,
    content: row.content,
    audienceMode: row.audienceMode as PostAudienceMode,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    moderationState: row.moderationState as PostModerationState,
    moderationReason: row.moderationReason,
  };
}

/**
 * Load a post by id, enforcing visibility for the actor. Returns the row.
 *
 * Authors get unconditional read; everyone else must satisfy:
 *   - not soft-deleted,
 *   - moderation state is `ok` or `limited`,
 *   - audience rules permit the viewer (all_contacts → author has them as a
 *     contact; selected → viewer is in `post_audience`).
 *
 * Every visibility failure returns `NotFound` — "doesn't exist" and "not
 * yours to see" look identical to the caller, since leaking existence is
 * itself a signal.
 *
 * Used by `getPost`, `togglePostLike`, and any future read/engagement
 * operation. Centralized here so the rules are written once.
 */
export async function assertCanViewPost(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<PostRow> {
  const [row] = await db.select().from(post).where(eq(post.id, postId)).limit(1);
  if (!row) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }

  const isAuthor = row.authorPersonaId === actor.personaId;
  if (isAuthor) return row;

  if (row.deletedAt) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }
  const moderationOk =
    row.moderationState === PostModerationState.Ok ||
    row.moderationState === PostModerationState.Limited;
  if (!moderationOk) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }
  const visible = await isVisibleToViewer(db, row, actor.personaId);
  if (!visible) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }

  return row;
}

async function isVisibleToViewer(
  db: Database,
  row: { id: string; authorPersonaId: string; audienceMode: string },
  viewerPersonaId: string,
): Promise<boolean> {
  if (row.audienceMode === PostAudienceMode.AllContacts) {
    const [match] = await db
      .select({ id: contact.ownerPersonaId })
      .from(contact)
      .where(
        and(
          eq(contact.ownerPersonaId, row.authorPersonaId),
          eq(contact.contactPersonaId, viewerPersonaId),
        ),
      )
      .limit(1);
    return !!match;
  }

  if (row.audienceMode === PostAudienceMode.Selected) {
    const [match] = await db
      .select({ id: postAudience.postId })
      .from(postAudience)
      .where(
        and(eq(postAudience.postId, row.id), eq(postAudience.audiencePersonaId, viewerPersonaId)),
      )
      .limit(1);
    return !!match;
  }

  return false;
}
