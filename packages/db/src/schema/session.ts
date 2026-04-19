import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { account } from './account.js';
import { persona } from './persona.js';

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    activePersonaId: uuid('active_persona_id')
      .notNull()
      .references(() => persona.id),
    /** sha-256 hex digest of the opaque refresh token. */
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    /** Stored as text in v0; consider native inet in v1. */
    ipAddress: text('ip_address'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    accountIdx: index('session_account_idx').on(table.accountId),
  }),
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
