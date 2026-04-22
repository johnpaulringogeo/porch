import { asc, eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona, postAudience } from '@porch/db';
import {
  PostAudienceMode,
  type Post,
  type PublicPersona,
} from '@porch/types/domain';
import type { CommentSummary, LikeSummary } from '@porch/types/api';
import { assertCanViewPost, toApiPost } from './helpers.js';
import { getLikeSummary } from './like.js';
import { toPublicPersona } from '../contact/helpers.js';
import { getCommentSummary } from '../comment/index.js';
import type { PostActor } from './create.js';

/**
 * Fetch a single post, enforcing visibility, plus — when the viewer is the
 * author of a `selected`-audience post — the list of personas in that
 * audience so the author can verify what they sent and to whom.
 *
 * Author-only:
 *   - Authors can always read their own posts (including moderated / pending
 *     ones) and see the full audience for selected-mode posts.
 *   - For every other viewer the post must be visible per `assertCanViewPost`
 *     (not deleted, moderation `ok`/`limited`, audience rules satisfied).
 *     Non-authors never see the audience list — they're a permitted
 *     viewer, that's the only fact they're entitled to know.
 *
 * `audiencePersonas` is null whenever it doesn't apply (non-author viewers,
 * or all_contacts posts, where the audience is "everyone you have as a
 * contact" and not worth enumerating). Sorted by display name so the UI
 * gets a stable, alphabetical ordering — `post_audience` doesn't carry an
 * insertion timestamp.
 *
 * `likeSummary` is computed for everyone — the count is public to anyone
 * who can see the post, and `liked` reflects the *viewer's* state.
 *
 * `commentSummary` is the same deal — public to anyone who can see the post.
 * No viewer-specific state on this one (yet); see CommentSummary docstring.
 */
export async function getPost(
  db: Database,
  actor: PostActor,
  postId: string,
): Promise<{
  post: Post;
  audiencePersonas: PublicPersona[] | null;
  likeSummary: LikeSummary;
  commentSummary: CommentSummary;
}> {
  const row = await assertCanViewPost(db, actor, postId);

  const isAuthor = row.authorPersonaId === actor.personaId;

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

  const likeSummary = await getLikeSummary(db, actor, row.id);
  const commentSummary = await getCommentSummary(db, row.id);

  return {
    post: toApiPost(row, toPublicPersona(authorRow)),
    audiencePersonas,
    likeSummary,
    commentSummary,
  };
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
