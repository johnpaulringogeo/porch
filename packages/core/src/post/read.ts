import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona, post, postAudience } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import {
  PostAudienceMode,
  PostModerationState,
  type Post,
  type PublicPersona,
} from '@porch/types/domain';
import { toApiPost } from './helpers.js';
import { toPublicPersona } from '../contact/helpers.js';
import type { PostActor } from './create.js';

/**
 * Fetch a single post, enforcing visibility, plus — when the viewer is the
 * author of a `selected`-audience post — the list of personas in that
 * audience so the author can verify what they sent and to whom.
 *
 * Author-only:
 *   - Authors can always read their own posts (including moderated / pending
 *     ones) and see the full audience for selected-mode posts.
 *   - For every other viewer the post must be:
 *       * not soft-deleted,
 *       * in a non-terminal moderation state (`ok` or `limited`),
 *       * visible under the audience rules:
 *           all_contacts → author must have the viewer as a contact,
 *           selected     → viewer must be in `post_audience`.
 *     Non-authors never see the audience list — they're a permitted
 *     viewer, that's the only fact they're entitled to know.
 *
 * `audiencePersonas` is null whenever it doesn't apply (non-author viewers,
 * or all_contacts posts, where the audience is "everyone you have as a
 * contact" and not worth enumerating). Sorted by display name so the UI
 * gets a stable, alphabetical ordering — `post_audience` doesn't carry an
 * insertion timestamp.
 *
 * We return 404 on every visibility failure — "not found" and "not allowed
 * to see" look identical to the caller, since leaking existence is itself
 * a signal.
 */
export async function getPost(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<{ post: Post; audiencePersonas: PublicPersona[] | null }> {
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

  const audiencePersonas =
    isAuthor && row.audienceMode === PostAudienceMode.Selected
      ? await loadSelectedAudience(db, row.id)
      : null;

  return {
    post: toApiPost(row, toPublicPersona(authorRow)),
    audiencePersonas,
  };
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

async function loadSelectedAudience(
  db: Database,
  postId: string,
): Promise<PublicPersona[]> {
  const rows = await db
    .select()
    .from(postAudience)
    .innerJoin(persona, eq(persona.id, postAudience.audiencePersonaId))
    .where(eq(postAudience.postId, postId))
    .orderBy(asc(persona.displayName), asc(persona.username));
  return rows.map((r) => toPublicPersona(r.persona));
}
