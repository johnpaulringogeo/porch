import type { Database } from '@porch/db';
import { parseDid } from './did.js';
import { buildPorchDidDocument, type DidDocument } from './document.js';

/**
 * Resolve a DID to its document.
 *
 * v0 only resolves Porch-hosted DIDs (`did:web:<porchHost>:users:*`). Resolution
 * short-circuits to a direct DB lookup — no HTTP fetch needed for our own DIDs.
 *
 * v1 adds: external did:web fetched via HTTPS, did:plc resolved via the
 * AT Protocol PLC directory.
 */
export async function resolveDid(
  db: Database,
  porchHost: string,
  did: string,
): Promise<DidDocument> {
  const { host, username } = parseDid(did);
  if (host === porchHost) {
    const doc = await buildPorchDidDocument(db, host, username);
    if (!doc) throw new Error(`Persona not found for DID: ${did}`);
    return doc;
  }
  throw new Error(`External DID resolution is not supported in v0: ${did}`);
}
