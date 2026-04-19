import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { account } from './account.js';

export const personaModerationState = pgEnum('persona_moderation_state', [
  'ok',
  'restricted',
  'suspended',
]);

export const persona = pgTable(
  'persona',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    /** Globally unique, [a-z0-9-]{3,32}, used in did:web URL. Case-insensitive. */
    username: text('username').notNull().unique(),
    /** did:web:<host>:users:<username> — derived but stored for fast lookup. */
    did: text('did').notNull().unique(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    moderationState: personaModerationState('moderation_state').notNull().default('ok'),
    moderationReason: text('moderation_reason'),
  },
  (table) => ({
    accountIdx: index('persona_account_idx').on(table.accountId),
    /** Only one default persona per account. Partial unique index. */
    defaultPerAccount: uniqueIndex('persona_default_per_account_idx')
      .on(table.accountId)
      .where(sql`${table.isDefault} = true`),
  }),
);

export type Persona = typeof persona.$inferSelect;
export type NewPersona = typeof persona.$inferInsert;

/**
 * Per-persona signing keys. v0 stores encrypted private keys in the DB.
 * v1 moves key material to KMS (Cloudflare / GCP Secret Manager).
 */
export const personaKey = pgTable(
  'persona_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    /** key-1, key-2, ... — used in DID fragment (did#key-1). */
    keyId: text('key_id').notNull(),
    /** `z` + base58btc multibase-encoded public key. */
    publicKeyMultibase: text('public_key_multibase').notNull(),
    /** base64(aes-256-gcm(iv || ciphertext || tag)) of the Ed25519 private key. */
    encryptedPrivateKey: text('encrypted_private_key').notNull(),
    algorithm: text('algorithm').notNull().default('Ed25519VerificationKey2020'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    personaIdx: index('persona_key_persona_idx').on(table.personaId),
  }),
);

export type PersonaKey = typeof personaKey.$inferSelect;
export type NewPersonaKey = typeof personaKey.$inferInsert;
