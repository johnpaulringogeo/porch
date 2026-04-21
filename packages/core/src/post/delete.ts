import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { post } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { PostActor } from './create.js';

/**
 * Soft-delete a post by setting `deletedAt`. Only the author may delete.
 *
 * We leave the row (and `post_audience` rows) in place so moderation and
 * abuse-reporting still have something to reference; feed/read paths filter
 * on `deletedAt IS NULL`.
 */
export async function deletePost(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<void> {
  const [existing] = await db.select().from(post).where(eq(post.id, postId)).limit(1);
  if (!existing || existing.deletedAt) {
    throw new PorchError(ErrorCode.NotFound, 'Post not found.');
  }
  if (existing.authorPersonaId !== actor.personaId) {
    throw new PorchError(ErrorCode.Forbidden, 'Only the author can delete this post.');
  }

  const [updated] = await db
    .update(post)
    .set({ deletedAt: new Date() })
    .where(and(eq(post.id, postId), isNull(post.deletedAt)))
    .returning();
  if (!updated) {
    throw new PorchError(ErrorCode.Conflict, 'Post was modified by another action.');
  }
}
