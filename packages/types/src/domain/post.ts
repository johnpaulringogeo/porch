import type { PublicPersona } from './persona.js';

export const PostMode = {
  Home: 'home',
  Public: 'public',
  Community: 'community',
  Professional: 'professional',
  Creators: 'creators',
} as const;
export type PostMode = (typeof PostMode)[keyof typeof PostMode];

export const PostModerationState = {
  Ok: 'ok',
  PendingReview: 'pending_review',
  Limited: 'limited',
  Hidden: 'hidden',
  Removed: 'removed',
} as const;
export type PostModerationState =
  (typeof PostModerationState)[keyof typeof PostModerationState];

export const PostAudienceMode = {
  AllContacts: 'all_contacts',
  Selected: 'selected',
} as const;
export type PostAudienceMode = (typeof PostAudienceMode)[keyof typeof PostAudienceMode];

export interface Post {
  id: string;
  author: PublicPersona;
  mode: PostMode;
  content: string;
  audienceMode: PostAudienceMode;
  createdAt: string;
  editedAt: string | null;
  moderationState: PostModerationState;
  /** Why moderation acted, if visible to the author or audience. Often null. */
  moderationReason: string | null;
}

export interface FeedPage {
  posts: Post[];
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

/**
 * A comment on a post. Not threaded in v0 — every comment references a post
 * directly, not another comment.
 *
 * Soft delete: when the underlying row has a `deletedAt`, the API does not
 * return it at all in listComments / count paths. We don't currently surface
 * a tombstone row for deleted comments — the count just drops by one. If we
 * add threading later we'll revisit this (a deleted parent with live replies
 * needs some kind of placeholder).
 */
export interface Comment {
  id: string;
  postId: string;
  author: PublicPersona;
  content: string;
  createdAt: string;
  editedAt: string | null;
}
