import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona, post } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { Post } from '@porch/types/domain';
import { toApiPost } from './helpers.js';
import { toPublicPersona } from '../contact/helpers.js';
import type { PostActor } from './create.js';

/**
 * Edit a post's content. Only the author can edit; the post must not be
 * soft-deleted. Mode and audience are immutable post-creation — changing
 * audience after publication would change who can see history, so v0 refuses.
 *
 * Sets `editedAt` on every successful edit so clients can render an "edited"
 * indicator.
 */
export async function editPost(
  db: Database,
  actor: PostActor,
  postId: string,
  content: string,
): Promise<Post> {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new PorchError(
      ErrorCode.UnprocessableEntity,
      'Post content cannot be empty.',
      'content',
    );
  }

  const [existing] = await db.select().from(post).where(eq(post.id, postId)).limit(1);
  if (!existing || existing.deletedAt) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }
  if (existing.authorPersonaId !== actor.personaId) {
    throw new PorchError(ErrorCode.Forbidden, 'Only the author can edit this post.');
  }

  const [updated] = await db
    .update(post)
    .set({ content, editedAt: new Date() })
    .where(and(eq(post.id, postId), isNull(post.deletedAt)))
    .returning();
  if (!updated) {
    throw new PorchError(ErrorCode.Conflict, 'Post was modified by another action.');
  }

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, updated.authorPersonaId))
    .limit(1);
  if (!authorRow) throw new Error('Post author persona missing');

  return toApiPost(updated, toPublicPersona(authorRow));
}
