import { pgTable, uuid, text, timestamp, pgEnum, index, primaryKey } from 'drizzle-orm/pg-core';
import { persona } from './persona';

export const postMode = pgEnum('post_mode', [
  'home',
  'public',
  'community',
  'professional',
  'creators',
]);

export const postAudienceMode = pgEnum('post_audience_mode', ['all_contacts', 'selected']);

export const postModerationState = pgEnum('post_moderation_state', [
  'ok',
  'pending_review',
  'limited',
  'hidden',
  'removed',
]);

export const post = pgTable(
  'post',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorPersonaId: uuid('author_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    mode: postMode('mode').notNull(),
    audienceMode: postAudienceMode('audience_mode').notNull().default('all_contacts'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    moderationState: postModerationState('moderation_state').notNull().default('ok'),
    moderationReason: text('moderation_reason'),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  },
  (table) => ({
    authorCreatedIdx: index('post_author_created_idx').on(table.authorPersonaId, table.createdAt),
    modeCreatedIdx: index('post_mode_created_idx').on(table.mode, table.createdAt),
  }),
);

export type Post = typeof post.$inferSelect;
export type NewPost = typeof post.$inferInsert;

/**
 * Snapshotted audience for posts with audience_mode = 'selected'.
 * Unused when audience_mode = 'all_contacts' (resolved at read time).
 */
export const postAudience = pgTable(
  'post_audience',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
    audiencePersonaId: uuid('audience_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.audiencePersonaId] }),
    audienceIdx: index('post_audience_audience_idx').on(table.audiencePersonaId),
  }),
);

export type PostAudience = typeof postAudience.$inferSelect;
export type NewPostAudience = typeof postAudience.$inferInsert;

/**
 * Like edge — at most one row per (post, persona). The composite PK doubles
 * as the lookup index for "count likes for post X" and "is persona P a liker
 * of X" queries (PK leading column covers count, full PK covers existence).
 *
 * No personaId-only index yet: there's no "list my likes" surface in v0.
 * Add one when that view ships.
 */
export const postLike = pgTable(
  'post_like',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.personaId] }),
  }),
);

export type PostLike = typeof postLike.$inferSelect;
export type NewPostLike = typeof postLike.$inferInsert;

/**
 * Comments on a post.
 *
 * Independent-row model — not threaded, no parentCommentId in v0. Threading
 * adds UI complexity (collapse/expand, indented replies, ordering within a
 * thread) that we don't want to invest in before we know whether comments
 * will be a heavy-use surface. Adding `parentCommentId` later is a non-
 * destructive migration — nullable column with no default — so the forward
 * path is cheap.
 *
 * Soft delete: a `deletedAt` timestamp rather than a hard delete, for the
 * same reasons as posts — moderation/abuse review needs the content to stick
 * around, and we can tombstone the row ("[deleted]") in the UI without
 * losing the reference for any notification/audit rows that pointed at it.
 *
 * Index choice: `(post_id, created_at desc, id desc)` covers the list-per-
 * post keyset pagination cleanly. Postgres can walk it backwards for the
 * "newest first" direction without a sort step. No author-only index yet —
 * there's no "show me all my comments" surface in v0.
 */
export const postComment = pgTable(
  'post_comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
    authorPersonaId: uuid('author_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    postCreatedIdx: index('post_comment_post_created_idx').on(
      table.postId,
      table.createdAt,
    ),
  }),
);

export type PostComment = typeof postComment.$inferSelect;
export type NewPostComment = typeof postComment.$inferInsert;
