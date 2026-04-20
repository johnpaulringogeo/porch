/**
 * Ed25519 key generation, multibase encoding, and AES-256-GCM at-rest encryption
 * for persona private keys.
 *
 * Per W3C did-core + Ed25519VerificationKey2020:
 *   publicKeyMultibase = 'z' + base58btc(0xed01 || rawPublicKey)
 *
 * The 0xed01 prefix is the multicodec for ed25519-pub.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';

export interface GeneratedKey {
  publicKeyRaw: Uint8Array;
  privateKeyRaw: Uint8Array;
  publicKeyMultibase: string;
}

export function generateEd25519Key(): GeneratedKey {
  const privateKeyRaw = ed25519.utils.randomPrivateKey();
  const publicKeyRaw = ed25519.getPublicKey(privateKeyRaw);
  return {
    privateKeyRaw,
    publicKeyRaw,
    publicKeyMultibase: encodeMultibasePublicKey(publicKeyRaw),
  };
}

const ED25519_PUB_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function encodeMultibasePublicKey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_PUB_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_PUB_MULTICODEC, 0);
  prefixed.set(publicKey, ED25519_PUB_MULTICODEC.length);
  return 'z' + base58.encode(prefixed);
}

export function decodeMultibasePublicKey(multibase: string): Uint8Array {
  if (!multibase.startsWith('z')) {
    throw new Error(`Unsupported multibase encoding: ${multibase[0]}`);
  }
  const decoded = base58.decode(multibase.slice(1));
  if (decoded.length < 3 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Decoded multibase is not an ed25519 public key (missing 0xed01 prefix)');
  }
  return decoded.slice(2);
}

// ---------- AES-256-GCM at-rest encryption ----------

const AES_GCM_IV_LENGTH = 12;

export async function encryptPrivateKey(
  privateKeyRaw: Uint8Array,
  encryptionKeyBase64: string,
): Promise<string> {
  const key = await importAesKey(encryptionKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privateKeyRaw),
  );
  // Pack: iv || ciphertext-with-tag
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return uint8ToBase64(packed);
}

export async function decryptPrivateKey(
  encryptedBase64: string,
  encryptionKeyBase64: string,
): Promise<Uint8Array> {
  const key = await importAesKey(encryptionKeyBase64);
  const packed = base64ToUint8(encryptedBase64);
  if (packed.length <= AES_GCM_IV_LENGTH) {
    throw new Error('Encrypted payload is too short');
  }
  const iv = packed.slice(0, AES_GCM_IV_LENGTH);
  const ciphertext = packed.slice(AES_GCM_IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(plaintext);
}

async function importAesKey(base64Key: string) {
  const raw = base64ToUint8(base64Key);
  if (raw.length !== 32) {
    throw new Error(`PERSONA_KEY_ENCRYPTION_KEY must decode to 32 bytes, got ${raw.length}`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
