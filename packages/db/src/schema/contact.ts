import { pgTable, uuid, text, timestamp, primaryKey, index, pgEnum } from 'drizzle-orm/pg-core';
import { persona } from './persona.js';

export const contactRequestStatus = pgEnum('contact_request_status', [
  'pending',
  'accepted',
  'declined',
  'cancelled',
]);

export const contactRequest = pgTable(
  'contact_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromPersonaId: uuid('from_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    toPersonaId: uuid('to_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    message: text('message'),
    status: contactRequestStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => ({
    fromIdx: index('contact_request_from_idx').on(table.fromPersonaId),
    toIdx: index('contact_request_to_idx').on(table.toPersonaId),
    statusIdx: index('contact_request_status_idx').on(table.status),
  }),
);

export type ContactRequest = typeof contactRequest.$inferSelect;
export type NewContactRequest = typeof contactRequest.$inferInsert;

/**
 * Mutual contact relationship. Stored as two rows per relationship (one per
 * direction) for query simplicity and to support per-owner nicknames.
 */
export const contact = pgTable(
  'contact',
  {
    ownerPersonaId: uuid('owner_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    contactPersonaId: uuid('contact_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    nickname: text('nickname'),
    establishedAt: timestamp('established_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ownerPersonaId, table.contactPersonaId] }),
    ownerIdx: index('contact_owner_idx').on(table.ownerPersonaId),
  }),
);

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;
