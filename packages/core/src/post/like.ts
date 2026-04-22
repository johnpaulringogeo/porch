import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { postLike } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { LikeSummary } from '@porch/types/api';
import { assertCanViewPost } from './helpers.js';
import type { PostActor } from './create.js';

/**
 * Like operations live next to the post module — they share the visibility
 * rules and there's no engagement surface yet that warrants its own package.
 *
 * v0 invariants:
 *   - You can only like a post you can read. Visibility check is the same one
 *     the read path uses, so no surface leaks (a non-permitted viewer sees a
 *     404 from like/unlike just like they would from GET /:id).
 *   - You can't like your own post. It's a "I see you" signal; self-likes are
 *     noise. The API returns BadRequest if you try.
 *   - `togglePostLike` is the only mutation entry point. We don't expose
 *     separate add/remove endpoints — the UI button is a toggle and the
 *     server is the source of truth for the resulting state.
 */

/**
 * Compute the like summary for one (post, viewer) pair.
 *
 * Two queries:
 *   1) does the viewer have a row in post_like for this post?
 *   2) total count of likes on the post
 *
 * Could be folded into one query (`SELECT COUNT(*), BOOL_OR(persona_id=$me)`)
 * but the two-query version is cheaper to read and the post-detail page is
 * not in any latency hot path. Both queries hit the (postId, personaId)
 * composite-PK btree — fast either way.
 *
 * No visibility check here: callers (`getPost`, `togglePostLike`) have
 * already enforced it via `assertCanViewPost`.
 */
export async function getLikeSummary(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<LikeSummary> {
  const [mine] = await db
    .select({ postId: postLike.postId })
    .from(postLike)
    .where(and(eq(postLike.postId, postId), eq(postLike.personaId, actor.personaId)))
    .limit(1);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(postLike)
    .where(eq(postLike.postId, postId));

  return {
    liked: !!mine,
    totalLikes: countRow?.total ?? 0,
  };
}

/**
 * Flip the actor's like state on a post and return the new summary.
 *
 * Concurrency: the underlying upsert/delete are idempotent under repeated
 * calls — a double-tap "like" twice in flight will leave a single row, and
 * a double-tap "unlike" leaves zero. We don't try to detect or undo the
 * race; the server response is authoritative and the UI reconciles to it.
 *
 * Returns `liked` from the *new* state plus the *new* total. The previous
 * state isn't surfaced — the caller already has it (it's what the user
 * tapped against) and propagating it adds noise without value.
 */
export async function togglePostLike(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<LikeSummary> {
  const row = await assertCanViewPost(db, actor, postId);

  if (row.authorPersonaId === actor.personaId) {
    throw new PorchError(
      ErrorCode.BadRequest,
      "You can't like your own post.",
    );
  }

  const [existing] = await db
    .select({ postId: postLike.postId })
    .from(postLike)
    .where(and(eq(postLike.postId, postId), eq(postLike.personaId, actor.personaId)))
    .limit(1);

  if (existing) {
    await db
      .delete(postLike)
      .where(and(eq(postLike.postId, postId), eq(postLike.personaId, actor.personaId)));
  } else {
    // ON CONFLICT DO NOTHING covers the racy "two like clicks in flight" case
    // — the second insert is a no-op and we still report `liked: true`.
    await db
      .insert(postLike)
      .values({ postId, personaId: actor.personaId })
      .onConflictDoNothing();
  }

  return getLikeSummary(db, actor, postId);
}
