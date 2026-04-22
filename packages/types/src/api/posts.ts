import { z } from 'zod';
import {
  PostAudienceMode,
  PostMode,
  type Comment,
  type FeedPage,
  type Post,
} from '../domain/post.js';
import type { PublicPersona } from '../domain/persona.js';

export const CreatePostRequest = z
  .object({
    mode: z.literal(PostMode.Home), // v0: Home only
    content: z.string().min(1).max(4000),
    audienceMode: z.enum([PostAudienceMode.AllContacts, PostAudienceMode.Selected]),
    /** Required when audienceMode === 'selected'. Persona IDs. */
    audiencePersonaIds: z.array(z.string().uuid()).max(512).optional(),
  })
  .refine(
    (val) =>
      val.audienceMode !== PostAudienceMode.Selected ||
      (val.audiencePersonaIds && val.audiencePersonaIds.length > 0),
    { message: "audiencePersonaIds required when audienceMode is 'selected'" },
  );
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

export const EditPostRequest = z.object({
  content: z.string().min(1).max(4000),
});
export type EditPostRequest = z.infer<typeof EditPostRequest>;

export const FeedQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

export interface CreatePostResponse {
  post: Post;
}

export interface GetPostResponse {
  post: Post;
  /**
   * The personas in the post's selected audience. Author-only:
   *   - null when the viewer is not the author, or when the post is not in
   *     `selected` audience mode (in which case "the audience" is just
   *     "all contacts" and we don't enumerate it),
   *   - an array (possibly empty, in pathological cases) when the viewer
   *     is the author of a `selected`-audience post.
   *
   * Order matches the persona IDs the author submitted when creating the
   * post, with any subsequently-removed contacts simply absent.
   */
  audiencePersonas: PublicPersona[] | null;
  likeSummary: LikeSummary;
  /**
   * Comment summary for this (post, viewer) pair. Excludes soft-deleted
   * comments. The detail page uses this as the seed value for the comments
   * section's count — the list endpoint returns a fresh count on each fetch
   * but we still want a number to render before the first list load.
   */
  commentSummary: CommentSummary;
}

/**
 * Like state for a (post, viewer) pair. Returned alongside the post on
 * GET /api/posts/:id and as the body of POST /api/posts/:id/like so the
 * UI can stay coherent without a follow-up read.
 *
 *   liked       — does the *viewer* currently have a like on this post?
 *   totalLikes  — total likers including (when liked=true) the viewer.
 *
 * Authors get a summary too: `liked` is always false on your own post in v0
 * because you can't like your own posts (the API rejects it), and the count
 * is the same view everyone else gets.
 */
export interface LikeSummary {
  liked: boolean;
  totalLikes: number;
}

export interface LikePostResponse {
  likeSummary: LikeSummary;
}

/**
 * Comment state for a post. Returned alongside posts on read/list endpoints
 * and as the body of comment create/delete so the UI can keep a count badge
 * coherent without a follow-up read.
 *
 *   totalComments — total non-deleted comments on the post.
 *
 * No viewer-specific flag on this one (yet). Unlike LikeSummary there's
 * nothing per-viewer to surface — you can comment on anything you can read
 * and every commenter is visible to every reader.
 */
export interface CommentSummary {
  totalComments: number;
}

export interface EditPostResponse {
  post: Post;
}

export interface ListMyPostsResponse {
  posts: Post[];
  /**
   * Like state per post in this page, keyed by post id. Every id in `posts`
   * has an entry; posts with no likes appear as `{ liked: false, totalLikes: 0 }`
   * rather than being omitted, so callers can lookup-and-render without a
   * coalesce.
   */
  likeSummaries: Record<string, LikeSummary>;
  /**
   * Comment counts per post in this page, keyed by post id. Every id in
   * `posts` has an entry; posts with no comments appear as
   * `{ totalComments: 0 }`. Same lookup-then-render contract as likeSummaries.
   */
  commentSummaries: Record<string, CommentSummary>;
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

/**
 * Home-feed response. Same shape as ListMyPostsResponse with the same
 * likeSummaries / commentSummaries semantics — every post id in this page
 * has an entry, with unliked/uncommented posts present as zero-value
 * summaries rather than omitted.
 */
export interface HomeFeedResponse extends FeedPage {
  likeSummaries: Record<string, LikeSummary>;
  commentSummaries: Record<string, CommentSummary>;
}

// ── Comments ───────────────────────────────────────────────────────────────

/**
 * POST /api/posts/:postId/comments
 *
 * The post id comes from the URL path, not the body — the route parameter is
 * the canonical scope. `content` is trimmed client-side before display but
 * we validate the raw length server-side to keep the contract tight.
 *
 * Max length mirrors posts (4000). Choose the same cap even though comments
 * are typically shorter so we don't have to explain "why does the comment
 * limit differ from posts"; easy to tighten later without breaking anyone.
 */
export const CreateCommentRequest = z.object({
  content: z.string().min(1).max(4000),
});
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

export interface CreateCommentResponse {
  comment: Comment;
  /**
   * Updated comment summary for the parent post — lets the UI update the
   * post's comment count pill without a separate read. Reflects the state
   * *including* the newly created comment.
   */
  commentSummary: CommentSummary;
}

/**
 * GET /api/posts/:postId/comments
 *
 *   ?cursor   opaque keyset cursor (createdAt desc, id desc) scoped to this post
 *   ?limit    1..100, default 50
 *
 * Returns non-deleted comments only, newest first. The list endpoint returns
 * the current commentSummary as well so the UI doesn't have to recompute a
 * count locally after any pagination step.
 */
export const ListCommentsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof ListCommentsQuery>;

export interface ListCommentsResponse {
  comments: Comment[];
  /** Current comment summary for the parent post — total non-deleted comments. */
  commentSummary: CommentSummary;
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

/**
 * PATCH /api/posts/:postId/comments/:commentId
 *
 * Author-only edit. Content-only — there's nothing else on a comment the
 * author could change. Max length mirrors CreateCommentRequest to keep the
 * client-side validation symmetric.
 *
 * Non-authors get a 404, not a 403, matching the mask used by delete — the
 * comment surface shouldn't leak whether a given id exists to a caller who
 * can't act on it.
 *
 * Sets `editedAt` on every successful edit so the UI can render an "edited"
 * indicator. No-op edits (same content) still bump the timestamp; the route
 * does not diff content server-side.
 */
export const UpdateCommentRequest = z.object({
  content: z.string().min(1).max(4000),
});
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequest>;

export interface UpdateCommentResponse {
  comment: Comment;
}

/**
 * DELETE /api/posts/:postId/comments/:commentId
 *
 * Author-only soft delete. Mirrors post-delete in that the row stays in the
 * database (for moderation review) but is invisible to future reads.
 *
 * Returns the updated count so the UI can decrement its badge without a
 * follow-up fetch.
 */
export interface DeleteCommentResponse {
  commentSummary: CommentSummary;
}
