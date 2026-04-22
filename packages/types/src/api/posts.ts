import { z } from 'zod';
import { PostAudienceMode, PostMode, type FeedPage, type Post } from '../domain/post.js';
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
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

/**
 * Home-feed response. Same shape as ListMyPostsResponse with the same
 * likeSummaries semantics — every post id in this page has an entry, with
 * unliked posts present as `{ liked: false, totalLikes: 0 }`.
 */
export interface HomeFeedResponse extends FeedPage {
  likeSummaries: Record<string, LikeSummary>;
}
