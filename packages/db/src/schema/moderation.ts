import { pgTable, uuid, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { persona } from './persona';

export const moderationReportStatus = pgEnum('moderation_report_status', [
  'open',
  'reviewing',
  'actioned',
  'dismissed',
]);

export const moderationReport = pgTable(
  'moderation_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterPersonaId: uuid('reporter_persona_id').references(() => persona.id, {
      onDelete: 'set null',
    }),
    /** 'post' | 'persona' — string for flexibility as we add entity types. */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    status: moderationReportStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
  },
  (table) => ({
    subjectIdx: index('moderation_subject_idx').on(table.subjectType, table.subjectId),
    statusIdx: index('moderation_status_idx').on(table.status),
  }),
);

export type ModerationReport = typeof moderationReport.$inferSelect;
export type NewModerationReport = typeof moderationReport.$inferInsert;
