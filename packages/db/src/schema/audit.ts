import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { account } from './account.js';
import { persona } from './persona.js';

/**
 * Append-only audit log of every state-changing action.
 * Convention enforced at service layer in v0; v1 adds DB-level row permissions.
 *
 * `action` follows `<entity>.<verb>` naming: 'auth.signup', 'post.create',
 * 'persona.switch', 'contact.accept', 'moderation.hide_post', etc.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
    personaId: uuid('persona_id').references(() => persona.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountCreatedIdx: index('audit_account_created_idx').on(table.accountId, table.createdAt),
    actionCreatedIdx: index('audit_action_created_idx').on(table.action, table.createdAt),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
