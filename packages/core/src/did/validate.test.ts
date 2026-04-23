import { describe, expect, it } from 'vitest';
import { generateEd25519Key } from './keys.js';
import type { DidDocument } from './document.js';
import { validateDidDocument } from './validate.js';

const HOST = 'example.com';
const DID = `did:web:${HOST}:users:alice`;

/**
 * Builds a minimal spec-conformant DID document for tests. Each scenario
 * then mutates one field and confirms the validator reports the expected
 * error. Using a freshly-generated key per call keeps the multibase decode
 * path exercised on real input rather than a stashed vector.
 */
function buildValidDoc(): DidDocument {
  const { publicKeyMultibase } = generateEd25519Key();
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: DID,
    controller: DID,
    verificationMethod: [
      {
        id: `${DID}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: DID,
        publicKeyMultibase,
      },
    ],
    authentication: [`${DID}#key-1`],
    assertionMethod: [`${DID}#key-1`],
    service: [
      {
        id: `${DID}#porch-profile`,
        type: 'PorchProfile',
        serviceEndpoint: `https://${HOST}/api/personas/alice/profile`,
      },
    ],
  };
}

describe('validateDidDocument — happy path', () => {
  it('accepts a full spec-conformant document', () => {
    const res = validateDidDocument(buildValidDoc());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('accepts a document with no service block', () => {
    const doc = buildValidDoc();
    // `service` is optional per the core spec; dropping it must not trip
    // any error.
    const { service: _omit, ...rest } = doc;
    void _omit;
    const res = validateDidDocument(rest);
    expect(res.valid).toBe(true);
  });

  it('accepts a document where controller is a single-element array', () => {
    const doc = buildValidDoc();
    const res = validateDidDocument({ ...doc, controller: [DID] });
    expect(res.valid).toBe(true);
  });
});

describe('validateDidDocument — rejects non-object inputs', () => {
  it('rejects null', () => {
    const res = validateDidDocument(null);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toMatch(/must be a JSON object/);
  });

  it('rejects arrays', () => {
    const res = validateDidDocument([]);
    expect(res.valid).toBe(false);
  });
});

describe('validateDidDocument — id field', () => {
  it('flags a missing id', () => {
    // Cast via `unknown` because DidDocument has no string index signature
    // and the direct cast would be a structural-type warning.
    const doc = buildValidDoc() as unknown as Record<string, unknown>;
    delete doc.id;
    const res = validateDidDocument(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /`id`/.test(e))).toBe(true);
  });

  it('flags a non-did:web id', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      id: 'did:key:zABC',
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /did:web:/.test(e))).toBe(true);
  });

  it('flags an empty-host did:web id', () => {
    // Note: bare `did:web:` leaves an empty host segment.
    const res = validateDidDocument({ ...buildValidDoc(), id: 'did:web:' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /host segment/.test(e))).toBe(true);
  });
});

describe('validateDidDocument — @context', () => {
  it('flags a missing context', () => {
    const doc = buildValidDoc() as unknown as Record<string, unknown>;
    delete doc['@context'];
    const res = validateDidDocument(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /@context/.test(e))).toBe(true);
  });

  it('flags a context that does not start with the W3C core URI', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      '@context': [
        'https://w3id.org/security/suites/ed25519-2020/v1',
        'https://www.w3.org/ns/did/v1',
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /@context\[0\]/.test(e))).toBe(true);
  });

  it('flags an Ed25519 VM without the matching context entry', () => {
    // Drop the ed25519-2020 context but keep the VM type. The validator
    // must notice the mismatch.
    const res = validateDidDocument({
      ...buildValidDoc(),
      '@context': ['https://www.w3.org/ns/did/v1'],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /ed25519-2020/.test(e))).toBe(true);
  });
});

describe('validateDidDocument — verificationMethod', () => {
  it('flags an empty verificationMethod array', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      verificationMethod: [],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /verificationMethod/.test(e))).toBe(true);
  });

  it('flags a VM id that is not rooted at the document DID', () => {
    const doc = buildValidDoc();
    const vm = doc.verificationMethod[0]!;
    const res = validateDidDocument({
      ...doc,
      verificationMethod: [
        { ...vm, id: `did:web:other.example:users:bob#key-1` },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /verificationMethod\[0\]\.id/.test(e))).toBe(
      true,
    );
  });

  it('flags duplicate verificationMethod ids', () => {
    const doc = buildValidDoc();
    const vm = doc.verificationMethod[0]!;
    const res = validateDidDocument({
      ...doc,
      verificationMethod: [vm, vm],
      authentication: [vm.id],
      assertionMethod: [vm.id],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /duplicates/.test(e))).toBe(true);
  });

  it('flags a non-Ed25519 VM type', () => {
    const doc = buildValidDoc();
    const vm = doc.verificationMethod[0]!;
    const res = validateDidDocument({
      ...doc,
      verificationMethod: [{ ...vm, type: 'JsonWebKey2020' }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /Ed25519VerificationKey2020/.test(e))).toBe(
      true,
    );
  });

  it('flags a controller that differs from the document DID', () => {
    const doc = buildValidDoc();
    const vm = doc.verificationMethod[0]!;
    const res = validateDidDocument({
      ...doc,
      verificationMethod: [
        { ...vm, controller: 'did:web:other.example:users:bob' },
      ],
    });
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => /verificationMethod\[0\]\.controller/.test(e)),
    ).toBe(true);
  });

  it('flags a publicKeyMultibase that does not start with "z"', () => {
    const doc = buildValidDoc();
    const vm = doc.verificationMethod[0]!;
    const res = validateDidDocument({
      ...doc,
      verificationMethod: [{ ...vm, publicKeyMultibase: 'mABCD' }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /base58btc/.test(e))).toBe(true);
  });

  it('flags a publicKeyMultibase missing the ed25519-pub multicodec prefix', () => {
    // A `z`-prefixed base58btc string of arbitrary bytes — decoder will
    // reject the missing 0xed01 multicodec prefix.
    const res = validateDidDocument({
      ...buildValidDoc(),
      verificationMethod: [
        {
          id: `${DID}#key-1`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: 'z6MkfakekeyThatWillDefinitelyFailDecode',
        },
      ],
      authentication: [`${DID}#key-1`],
      assertionMethod: [`${DID}#key-1`],
    });
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => /publicKeyMultibase/.test(e)),
    ).toBe(true);
  });
});

describe('validateDidDocument — authentication/assertionMethod references', () => {
  it('flags a reference that does not match any verificationMethod.id', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      authentication: [`${DID}#key-does-not-exist`],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /authentication\[0\]/.test(e))).toBe(true);
  });

  it('flags a non-string reference', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      authentication: [{ notAString: true }],
    });
    expect(res.valid).toBe(false);
  });
});

describe('validateDidDocument — service', () => {
  it('flags a non-http(s) serviceEndpoint', () => {
    const doc = buildValidDoc();
    const svc = doc.service![0]!;
    const res = validateDidDocument({
      ...doc,
      service: [{ ...svc, serviceEndpoint: 'ftp://example.com/' }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /serviceEndpoint/.test(e))).toBe(true);
  });

  it('flags a service entry missing id or type', () => {
    const res = validateDidDocument({
      ...buildValidDoc(),
      service: [
        {
          serviceEndpoint: 'https://example.com/',
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /service\[0\]\.id/.test(e))).toBe(true);
    expect(res.errors.some((e) => /service\[0\]\.type/.test(e))).toBe(true);
  });
});

describe('validateDidDocument — buildPorchDidDocument output', () => {
  // Cross-check: a document shaped exactly like `buildPorchDidDocument`
  // emits for a real persona+key must validate clean. Guards against
  // drift between the builder and the validator.
  it('accepts a document with the same shape buildPorchDidDocument emits', () => {
    const { publicKeyMultibase } = generateEd25519Key();
    const id = 'did:web:localhost%3A3000:users:matt';
    const vmId = `${id}#key-1`;
    const doc: DidDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      id,
      controller: id,
      verificationMethod: [
        {
          id: vmId,
          type: 'Ed25519VerificationKey2020',
          controller: id,
          publicKeyMultibase,
        },
      ],
      authentication: [vmId],
      assertionMethod: [vmId],
      service: [
        {
          id: `${id}#porch-profile`,
          type: 'PorchProfile',
          serviceEndpoint: 'http://localhost:3000/api/personas/matt/profile',
        },
      ],
    };
    const res = validateDidDocument(doc);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('accepts a doc with multiple keys as long as each id is unique', () => {
    const k1 = generateEd25519Key();
    const k2 = generateEd25519Key();
    const doc: DidDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      id: DID,
      controller: DID,
      verificationMethod: [
        {
          id: `${DID}#key-1`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: k1.publicKeyMultibase,
        },
        {
          id: `${DID}#key-2`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: k2.publicKeyMultibase,
        },
      ],
      authentication: [`${DID}#key-1`, `${DID}#key-2`],
      assertionMethod: [`${DID}#key-1`, `${DID}#key-2`],
    };
    const res = validateDidDocument(doc);
    expect(res.valid).toBe(true);
  });
});
