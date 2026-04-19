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
