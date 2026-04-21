import { and, eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona, post, postAudience } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { PostAudienceMode, PostModerationState, type Post } from '@porch/types/domain';
import { toApiPost } from './helpers.js';
import { toPublicPersona } from '../contact/helpers.js';
import type { PostActor } from './create.js';

/**
 * Fetch a single post, enforcing visibility.
 *
 * Authors can always read their own posts (including moderated / pending
 * ones). For every other viewer, the post must be:
 *   - not soft-deleted,
 *   - in a non-terminal moderation state (`ok` or `limited`),
 *   - visible under the audience rules:
 *       all_contacts → author must have the viewer as a contact,
 *       selected     → viewer must be in `post_audience`.
 *
 * We return 404 on every failure mode — "not found" and "not allowed to see"
 * look identical to the caller, since leaking existence is itself a signal.
 */
export async function getPost(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<Post> {
  const [row] = await db.select().from(post).where(eq(post.id, postId)).limit(1);
  if (!row) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }

  const isAuthor = row.authorPersonaId === actor.personaId;

  if (!isAuthor) {
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
  }

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, row.authorPersonaId))
    .limit(1);
  if (!authorRow) throw new Error('Post author persona missing');

  return toApiPost(row, toPublicPersona(authorRow));
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
