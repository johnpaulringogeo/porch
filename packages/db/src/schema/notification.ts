import { pgTable, uuid, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { persona } from './persona';

export const notificationType = pgEnum('notification_type', [
  'contact_request_received',
  'contact_request_accepted',
  'contact_request_declined',
  'post_selected_audience',
  'post_liked',
  'comment_created',
  'post_moderated',
  'account_moderated',
  'system',
]);

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientPersonaId: uuid('recipient_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (table) => ({
    recipientCreatedIdx: index('notification_recipient_created_idx').on(
      table.recipientPersonaId,
      table.createdAt,
    ),
  }),
);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
