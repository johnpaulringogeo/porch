import { ed25519 } from '@noble/curves/ed25519';
import { and, eq, isNull } from 'drizzle-orm';
import { personaKey, type Database } from '@porch/db';
import { decryptPrivateKey, decodeMultibasePublicKey } from './keys.js';

export interface SignResult {
  keyId: string;
  signature: Uint8Array;
}

/**
 * Sign a message using the persona's currently-active key.
 *
 * v0 doesn't yet sign anything (records aren't published to ATProto until v1),
 * but the keys exist and this entry point is wired so the rest of the system
 * is forward-compatible.
 */
export async function signWithPersonaKey(
  db: Database,
  personaId: string,
  encryptionKey: string,
  message: Uint8Array,
): Promise<SignResult> {
  const rows = await db
    .select()
    .from(personaKey)
    .where(and(eq(personaKey.personaId, personaId), isNull(personaKey.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`No active key for persona ${personaId}`);

  const privateKey = await decryptPrivateKey(row.encryptedPrivateKey, encryptionKey);
  const signature = ed25519.sign(message, privateKey);
  return { keyId: row.keyId, signature };
}

export function verifyWithDidKey(
  publicKeyMultibase: string,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const publicKey = decodeMultibasePublicKey(publicKeyMultibase);
  return ed25519.verify(signature, message, publicKey);
}
