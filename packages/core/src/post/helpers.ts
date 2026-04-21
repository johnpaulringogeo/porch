import type { Post as PostRow } from '@porch/db';
import type {
  Post,
  PostAudienceMode,
  PostMode,
  PostModerationState,
  PublicPersona,
} from '@porch/types/domain';

/**
 * Map a DB post row + its resolved author into the API `Post` shape.
 *
 * Drops author lookup/joining concerns — callers are expected to have already
 * materialized the author as a `PublicPersona`. Moderation reason is surfaced
 * here; routes decide whether to redact it for non-author viewers (in v0 we
 * just leak it uniformly; trust & safety will tighten this).
 */
export function toApiPost(row: PostRow, author: PublicPersona): Post {
  return {
    id: row.id,
    author,
    mode: row.mode as PostMode,
    content: row.content,
    audienceMode: row.audienceMode as PostAudienceMode,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    moderationState: row.moderationState as PostModerationState,
    moderationReason: row.moderationReason,
  };
}
