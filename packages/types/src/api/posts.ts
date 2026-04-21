import { z } from 'zod';
import { PostAudienceMode, PostMode, type FeedPage, type Post } from '../domain/post.js';

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
}

export interface EditPostResponse {
  post: Post;
}

export interface ListMyPostsResponse {
  posts: Post[];
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

export type HomeFeedResponse = FeedPage;
