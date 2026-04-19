import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Generate an opaque 32-byte refresh token (base64url) and return both the
 * raw token (to send to the client) and its sha-256 hex hash (to store).
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = base64url(raw);
  const tokenHash = bytesToHex(sha256(new TextEncoder().encode(token)));
  return { token, tokenHash };
}

export function hashRefreshToken(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
