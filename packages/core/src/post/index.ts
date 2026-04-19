/**
 * Home-mode post creation and moderation state transitions. Stubs in v0 —
 * implementations land as we wire up /api/posts and /api/moderation.
 *
 * Moderation state machine for posts:
 *   ok → pending_review → limited | hidden | removed | ok
 *   ok → hidden         (admin action)
 *   ok → removed        (admin action, terminal for most purposes)
 *
 * Every transition writes an audit log entry via recordAudit().
 */

// Implementations TODO:
//   export async function createHomePost(db, ctx, input: CreatePostRequest): Promise<Post>
//   export async function deletePost(db, ctx, postId): Promise<void>       // soft delete
//   export async function editPost(db, ctx, postId, newContent): Promise<Post>
//   export async function setPostModerationState(db, ctx, postId, state, reason): Promise<void>

export {};
