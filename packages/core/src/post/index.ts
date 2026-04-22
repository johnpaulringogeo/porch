/**
 * Home-mode post CRUD for v0.
 *
 * - Create: inserts a post plus (for `selected` audience) snapshots the
 *   audience persona IDs. Selected-audience IDs must be current contacts of
 *   the author; otherwise the whole write is rejected.
 * - Read: enforces visibility — author sees everything; other viewers only
 *   see non-deleted posts in `ok`/`limited` moderation state that the
 *   audience rules let them see. Invisible-to-viewer and not-found look
 *   identical (both 404) so existence isn't leaked.
 * - Edit: author-only, content-only. `mode` and audience are immutable.
 * - Delete: author-only soft delete (sets `deletedAt`); rows stay around for
 *   moderation/abuse review.
 * - List my posts: keyset pagination shared with the feed cursor format.
 *
 * Moderation state machine (future):
 *   ok → pending_review → limited | hidden | removed | ok
 *   ok → hidden         (admin action)
 *   ok → removed        (admin action, terminal)
 * Public/Community/Professional/Creators modes land in later milestones.
 */
export { createPost } from './create.js';
export type { CreatePostInput, PostActor } from './create.js';
export { getPost } from './read.js';
export { editPost } from './update.js';
export { deletePost } from './delete.js';
export { listMyPosts } from './list.js';
export type { ListMyPostsParams, ListMyPostsResult } from './list.js';
export { listPersonaPosts } from './list-persona.js';
export type {
  ListPersonaPostsParams,
  ListPersonaPostsResult,
} from './list-persona.js';
export { togglePostLike, getLikeSummary } from './like.js';
export { toApiPost, assertCanViewPost } from './helpers.js';
