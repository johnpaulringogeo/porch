import { describe, expect, it } from 'vitest';
import type { Database } from '@porch/db';
import { createPersona } from './create.js';
import { decryptPrivateKey, decodeMultibasePublicKey } from '../did/keys.js';

// 32 bytes of zero, base64-encoded. Fine for tests — real env gets a random key.
const TEST_ENCRYPTION_KEY = 'A'.repeat(43) + '=';
const TEST_HOST = 'localhost%3A3000';

/**
 * Minimal Database fake that exercises only the Drizzle call chain
 * createPersona actually uses:
 *
 *   db.transaction(async (tx) => {
 *     await tx.insert(table).values({...}).returning();  // persona
 *     await tx.insert(table).values({...});              // personaKey
 *   });
 *
 * Records every insert so tests can assert on the payloads.
 */
interface InsertCall {
  table: unknown;
  values: Record<string, unknown>;
}

function makeFakeDb(personaIdOverride = 'persona_test_01') {
  const inserts: InsertCall[] = [];

  const tx = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            async returning() {
              // Echo the inserted row back with a synthetic id — mimics
              // Postgres RETURNING on the persona table.
              return [
                {
                  id: personaIdOverride,
                  accountId: values.accountId,
                  username: values.username,
                  did: values.did,
                  displayName: values.displayName,
                  bio: values.bio ?? null,
                  isDefault: values.isDefault ?? false,
                },
              ];
            },
          };
        },
      };
    },
  };

  const db = {
    async transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };

  return { db: db as unknown as Database, inserts };
}

describe('createPersona', () => {
  it('returns the created persona with a did:web identifier', async () => {
    const { db, inserts } = makeFakeDb();

    const result = await createPersona(db, {
      accountId: 'acct_abc',
      username: 'alice',
      displayName: 'Alice',
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    expect(result.id).toBe('persona_test_01');
    expect(result.username).toBe('alice');
    expect(result.did).toBe('did:web:localhost%3A3000:users:alice');
    expect(result.displayName).toBe('Alice');
    expect(result.bio).toBeNull();
    expect(result.isDefault).toBe(false);
    expect(inserts).toHaveLength(2); // persona + personaKey
  });

  it('lowercases the username and reflects that in the did', async () => {
    const { db, inserts } = makeFakeDb();

    const result = await createPersona(db, {
      accountId: 'acct_abc',
      username: 'MixedCaseUser',
      displayName: 'Mixed',
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    expect(result.username).toBe('mixedcaseuser');
    expect(result.did).toBe('did:web:localhost%3A3000:users:mixedcaseuser');
    // The persona insert payload should also be lowercased.
    expect(inserts[0]!.values.username).toBe('mixedcaseuser');
  });

  it('passes bio and isDefault through when provided', async () => {
    const { db } = makeFakeDb();

    const result = await createPersona(db, {
      accountId: 'acct_abc',
      username: 'alice',
      displayName: 'Alice',
      bio: 'Hi there',
      isDefault: true,
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    expect(result.bio).toBe('Hi there');
    expect(result.isDefault).toBe(true);
  });

  it('writes a persona_key row whose encrypted private key decrypts to the published public key', async () => {
    const { db, inserts } = makeFakeDb();

    await createPersona(db, {
      accountId: 'acct_abc',
      username: 'alice',
      displayName: 'Alice',
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    const personaKeyInsert = inserts[1]!;
    expect(personaKeyInsert.values.keyId).toBe('key-1');
    expect(personaKeyInsert.values.publicKeyMultibase).toMatch(/^z/); // multibase 'z' prefix

    const publicKeyRaw = decodeMultibasePublicKey(
      personaKeyInsert.values.publicKeyMultibase as string,
    );
    expect(publicKeyRaw.length).toBe(32); // ed25519 public key is 32 bytes

    // The at-rest ciphertext should decrypt back to a 32-byte ed25519 private key.
    const decrypted = await decryptPrivateKey(
      personaKeyInsert.values.encryptedPrivateKey as string,
      TEST_ENCRYPTION_KEY,
    );
    expect(decrypted.length).toBe(32);
  });

  it('generates a fresh keypair on each call', async () => {
    const { db: db1, inserts: inserts1 } = makeFakeDb();
    const { db: db2, inserts: inserts2 } = makeFakeDb();

    await createPersona(db1, {
      accountId: 'acct_abc',
      username: 'alice',
      displayName: 'Alice',
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    await createPersona(db2, {
      accountId: 'acct_abc',
      username: 'alice',
      displayName: 'Alice',
      porchHost: TEST_HOST,
      personaKeyEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    expect(inserts1[1]!.values.publicKeyMultibase).not.toBe(
      inserts2[1]!.values.publicKeyMultibase,
    );
  });
});
