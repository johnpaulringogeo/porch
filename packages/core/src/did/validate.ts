/**
 * W3C DID Core + did:web validator.
 *
 * Checks that a DID document object satisfies:
 *   - W3C DID Core required-property rules (https://www.w3.org/TR/did-core/)
 *   - did:web method resolution conventions
 *     (https://w3c-ccg.github.io/did-method-web/)
 *   - Ed25519VerificationKey2020 suite requirements
 *     (https://www.w3.org/community/reports/credentials/CG-FINAL-di-eddsa-2020-20220724/)
 *
 * Pure — no network, no DB. Callers that want a "the document we just
 * built passes spec" assertion run the output of `buildPorchDidDocument`
 * through this and fail loudly on non-empty errors.
 *
 * Returns every violation found, not just the first, so a batch fix-up
 * doesn't need N round-trips. Errors are human-readable strings; we don't
 * model them as codes because the surface is "fix the spec gap", not
 * "branch on which gap".
 *
 * What we DON'T check (and why):
 *   - Cryptographic key validity. Decoding the multibase and confirming
 *     the ed25519 point is on-curve happens in `decodeMultibasePublicKey`.
 *     Mixing that in here would drag the crypto deps into the validator.
 *   - HTTP resolvability. That's the resolver's job — we'd be implementing
 *     `did:web` resolution end-to-end otherwise. A co-located test that
 *     actually fetches /.well-known/did/users/<u>/did.json is a separate
 *     concern (and would be an integration test, not a unit test).
 */

import { decodeMultibasePublicKey } from './keys.js';

export interface DidValidationResult {
  valid: boolean;
  errors: string[];
}

const DID_WEB_PREFIX = 'did:web:';
/** Required base context per https://www.w3.org/TR/did-core/#dfn-context. */
const CORE_CONTEXT = 'https://www.w3.org/ns/did/v1';
const ED25519_2020_CONTEXT = 'https://w3id.org/security/suites/ed25519-2020/v1';
const ED25519_2020_TYPE = 'Ed25519VerificationKey2020';

/**
 * Validate a DID document. Returns `{ valid, errors }`; a document with no
 * errors is considered spec-conformant for the slice of the spec Porch
 * actually uses in v0.
 */
export function validateDidDocument(doc: unknown): DidValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(doc)) {
    return { valid: false, errors: ['Document must be a JSON object.'] };
  }

  // ── id ──────────────────────────────────────────────────────────────────
  const id = doc.id;
  if (typeof id !== 'string' || id.length === 0) {
    errors.push('`id` must be a non-empty string (the DID itself).');
  } else if (!id.startsWith(DID_WEB_PREFIX)) {
    errors.push(`\`id\` must start with "${DID_WEB_PREFIX}" (got: ${id}).`);
  } else {
    validateDidWebShape(id, errors);
  }

  // ── @context ────────────────────────────────────────────────────────────
  // W3C requires https://www.w3.org/ns/did/v1 to appear first when the
  // document is represented as JSON-LD. Porch always emits JSON-LD.
  const context = doc['@context'];
  if (!Array.isArray(context)) {
    errors.push('`@context` must be an array.');
  } else {
    if (context[0] !== CORE_CONTEXT) {
      errors.push(
        `\`@context[0]\` must be "${CORE_CONTEXT}" (got: ${String(context[0])}).`,
      );
    }
    if (context.some((c) => typeof c !== 'string')) {
      errors.push('`@context` entries must all be strings.');
    }
  }

  // ── controller (optional, but if present must be a DID or DID array) ───
  if ('controller' in doc) {
    const controller = doc.controller;
    const ctrlValues = Array.isArray(controller) ? controller : [controller];
    for (const c of ctrlValues) {
      if (typeof c !== 'string' || !c.startsWith(DID_WEB_PREFIX)) {
        errors.push(
          `\`controller\` entries must be did:web DIDs (got: ${String(c)}).`,
        );
      }
    }
  }

  // ── verificationMethod ─────────────────────────────────────────────────
  const vmRaw = doc.verificationMethod;
  const vmList = Array.isArray(vmRaw) ? vmRaw : [];
  if (!Array.isArray(vmRaw)) {
    errors.push('`verificationMethod` must be an array.');
  } else if (vmRaw.length === 0) {
    // Not strictly required by the core spec, but Porch personas always
    // publish at least one signing key — absence is a Porch-specific bug.
    errors.push(
      '`verificationMethod` must contain at least one key (Porch convention).',
    );
  }

  const vmIds = new Set<string>();
  const hasEd25519Context =
    Array.isArray(context) && context.includes(ED25519_2020_CONTEXT);
  // `id` is still `unknown` here (the earlier branches populated errors but
  // didn't narrow). Pass a string or undefined so the helper can cross-check
  // VM ids against the document DID when we have one.
  const docIdForVm: string | undefined = typeof id === 'string' ? id : undefined;
  vmList.forEach((vm, i) => {
    validateVerificationMethod(
      vm,
      i,
      docIdForVm,
      hasEd25519Context,
      vmIds,
      errors,
    );
  });

  // ── authentication / assertionMethod ───────────────────────────────────
  // Both are arrays of either full VM objects or references (strings that
  // match a VM id declared above). v0 always emits references, so that's
  // what the validator enforces — embedded VM support can be added when we
  // actually start using it.
  for (const relationship of ['authentication', 'assertionMethod'] as const) {
    if (!(relationship in doc)) continue;
    const entries = doc[relationship];
    if (!Array.isArray(entries)) {
      errors.push(`\`${relationship}\` must be an array.`);
      continue;
    }
    entries.forEach((ref, i) => {
      if (typeof ref !== 'string') {
        errors.push(
          `\`${relationship}[${i}]\` must be a string reference to a verificationMethod.id.`,
        );
      } else if (vmIds.size > 0 && !vmIds.has(ref)) {
        errors.push(
          `\`${relationship}[${i}]\` references "${ref}" which is not a declared verificationMethod.id.`,
        );
      }
    });
  }

  // ── service (optional; if present, validate shape) ─────────────────────
  if ('service' in doc) {
    const services = doc.service;
    if (!Array.isArray(services)) {
      errors.push('`service` must be an array.');
    } else {
      services.forEach((svc, i) => {
        if (!isPlainObject(svc)) {
          errors.push(`\`service[${i}]\` must be an object.`);
          return;
        }
        if (typeof svc.id !== 'string' || svc.id.length === 0) {
          errors.push(`\`service[${i}].id\` must be a non-empty string.`);
        }
        if (typeof svc.type !== 'string' || svc.type.length === 0) {
          errors.push(`\`service[${i}].type\` must be a non-empty string.`);
        }
        if (
          typeof svc.serviceEndpoint !== 'string' ||
          !/^https?:\/\//.test(svc.serviceEndpoint as string)
        ) {
          errors.push(
            `\`service[${i}].serviceEndpoint\` must be an http(s) URL.`,
          );
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * did:web shape: `did:web:<host>[:<path-segment>]*`. We don't parse it all
 * the way to a resolution URL here (that's did.ts's job); we just confirm
 * the first segment after the method is a non-empty host.
 */
function validateDidWebShape(did: string, errors: string[]): void {
  const rest = did.slice(DID_WEB_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length < 1 || !parts[0]) {
    errors.push(`\`id\` "${did}" is malformed: missing host segment.`);
    return;
  }
  // Per did:web, ':' in host is encoded as %3A. Accept both literal ':'
  // via multiple segments and the encoded form in a single segment, since
  // local dev uses the encoded form (did:web:localhost%3A3000:...).
  const host = parts[0];
  if (/\s/.test(host)) {
    errors.push(`\`id\` "${did}" host contains whitespace.`);
  }
}

function validateVerificationMethod(
  vm: unknown,
  index: number,
  docId: string | undefined,
  hasEd25519Context: boolean,
  seenIds: Set<string>,
  errors: string[],
): void {
  const path = `verificationMethod[${index}]`;

  if (!isPlainObject(vm)) {
    errors.push(`\`${path}\` must be an object.`);
    return;
  }

  // id — must be a URL-ish DID fragment rooted at the document's DID.
  if (typeof vm.id !== 'string' || vm.id.length === 0) {
    errors.push(`\`${path}.id\` must be a non-empty string.`);
  } else {
    if (typeof docId === 'string' && !vm.id.startsWith(`${docId}#`)) {
      errors.push(
        `\`${path}.id\` must start with the document's DID followed by "#" (got: ${vm.id}).`,
      );
    }
    if (seenIds.has(vm.id)) {
      errors.push(`\`${path}.id\` duplicates a prior verificationMethod.id.`);
    } else {
      seenIds.add(vm.id);
    }
  }

  // type
  if (vm.type !== ED25519_2020_TYPE) {
    errors.push(
      `\`${path}.type\` must be "${ED25519_2020_TYPE}" (got: ${String(vm.type)}).`,
    );
  } else if (!hasEd25519Context) {
    // Ed25519VerificationKey2020 requires the matching context entry so
    // JSON-LD consumers resolve the term.
    errors.push(
      `\`${path}.type\` is Ed25519VerificationKey2020 but document \`@context\` is missing "${ED25519_2020_CONTEXT}".`,
    );
  }

  // controller
  if (typeof vm.controller !== 'string' || vm.controller.length === 0) {
    errors.push(`\`${path}.controller\` must be a non-empty DID string.`);
  } else if (typeof docId === 'string' && vm.controller !== docId) {
    // Porch currently always self-controls its keys; a different controller
    // would be unusual (delegated signing, which we don't ship in v0).
    errors.push(
      `\`${path}.controller\` must equal the document's DID (got: ${vm.controller}).`,
    );
  }

  // publicKeyMultibase — z-prefixed base58btc of 0xed01 + raw-32-byte pub key.
  if (typeof vm.publicKeyMultibase !== 'string') {
    errors.push(`\`${path}.publicKeyMultibase\` must be a string.`);
  } else {
    validateEd25519Multibase(vm.publicKeyMultibase, path, errors);
  }
}

function validateEd25519Multibase(
  value: string,
  path: string,
  errors: string[],
): void {
  if (!value.startsWith('z')) {
    errors.push(
      `\`${path}.publicKeyMultibase\` must start with "z" (base58btc per multibase spec).`,
    );
    return;
  }
  try {
    const raw = decodeMultibasePublicKey(value);
    if (raw.length !== 32) {
      errors.push(
        `\`${path}.publicKeyMultibase\` decoded to ${raw.length} bytes; ed25519 public keys are 32 bytes.`,
      );
    }
  } catch (err) {
    errors.push(
      `\`${path}.publicKeyMultibase\` failed to decode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
