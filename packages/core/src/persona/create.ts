import { persona, personaKey, type Database } from '@porch/db';
import { buildDid } from '../did/did.js';
import { encryptPrivateKey, generateEd25519Key } from '../did/keys.js';

export interface CreatePersonaInput {
  accountId: string;
  username: string;
  displayName: string;
  bio?: string;
  isDefault?: boolean;
  porchHost: string;
  personaKeyEncryptionKey: string;
}

export interface CreatedPersona {
  id: string;
  username: string;
  did: string;
  displayName: string;
  bio: string | null;
  isDefault: boolean;
}

/**
 * Atomically create a persona and its initial signing key.
 *
 * - Generates Ed25519 keypair.
 * - Encrypts the private key at rest.
 * - Computes the did:web identifier from host + username.
 * - Persists persona + persona_key rows.
 *
 * Assumes the username has already been validated and reserved-name-checked.
 */
export async function createPersona(
  db: Database,
  input: CreatePersonaInput,
): Promise<CreatedPersona> {
  const lower = input.username.toLowerCase();
  const did = buildDid(input.porchHost, lower);
  const key = generateEd25519Key();
  const encryptedPrivateKey = await encryptPrivateKey(
    key.privateKeyRaw,
    input.personaKeyEncryptionKey,
  );

  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(persona)
      .values({
        accountId: input.accountId,
        username: lower,
        did,
        displayName: input.displayName,
        bio: input.bio ?? null,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    if (!p) throw new Error('Failed to create persona');

    await tx.insert(personaKey).values({
      personaId: p.id,
      keyId: 'key-1',
      publicKeyMultibase: key.publicKeyMultibase,
      encryptedPrivateKey,
    });

    return {
      id: p.id,
      username: p.username,
      did: p.did,
      displayName: p.displayName,
      bio: p.bio,
      isDefault: p.isDefault,
    };
  });
}
