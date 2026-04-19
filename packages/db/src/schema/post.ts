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
