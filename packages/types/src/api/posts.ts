import { z } from 'zod';
import { PostAudienceMode, PostMode } from '../domain/post.js';

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

export const FeedQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeedQuery = z.infer<typeof FeedQuery>;
