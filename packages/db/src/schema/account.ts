import { pgTable, uuid, text, timestamp, pgEnum, integer } from 'drizzle-orm/pg-core';

export const accountStatus = pgEnum('account_status', [
  'active',
  'restricted',
  'suspended',
  'deletion_requested',
  'deleted',
]);

export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  emailVerificationToken: text('email_verification_token'),
  passwordHash: text('password_hash').notNull(),
  status: accountStatus('status').notNull().default('active'),
  ageAttestedAt: timestamp('age_attested_at', { withTimezone: true }),
  ageJurisdiction: text('age_jurisdiction'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
