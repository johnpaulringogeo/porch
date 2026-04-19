import { eq } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { and } from 'drizzle-orm';
import { persona, personaKey } from '@porch/db';
import type { Database } from '@porch/db';
import { buildDid } from './did.js';

export interface DidDocument {
  '@context': string[];
  id: string;
  controller: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: 'Ed25519VerificationKey2020';
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/**
 * Build the DID document for a persona by reading the persona row and its
 * active (non-revoked) keys from the database.
 *
 * Returns null if the persona doesn't exist or has been archived.
 */
export async function buildPorchDidDocument(
  db: Database,
  host: string,
  username: string,
): Promise<DidDocument | null> {
  const lower = username.toLowerCase();

  const found = await db
    .select()
    .from(persona)
    .where(and(eq(persona.username, lower), isNull(persona.archivedAt)))
    .limit(1);
  const personaRow = found[0];
  if (!personaRow) return null;

  const keys = await db
    .select()
    .from(personaKey)
    .where(and(eq(personaKey.personaId, personaRow.id), isNull(personaKey.revokedAt)));

  const did = buildDid(host, lower);

  const verificationMethods: VerificationMethod[] = keys.map((key) => ({
    id: `${did}#${key.keyId}`,
    type: 'Ed25519VerificationKey2020',
    controller: did,
    publicKeyMultibase: key.publicKeyMultibase,
  }));

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: verificationMethods,
    authentication: verificationMethods.map((vm) => vm.id),
    assertionMethod: verificationMethods.map((vm) => vm.id),
    service: [
      {
        id: `${did}#porch-profile`,
        type: 'PorchProfile',
        serviceEndpoint: `https://${host.replaceAll('%3A', ':')}/api/personas/${lower}/profile`,
      },
    ],
  };
}
