/**
 * Password hashing with Argon2id.
 *
 * Uses hash-wasm — WASM implementation that runs on both Node.js and Cloudflare
 * Workers / other edge runtimes. Native `argon2` won't build on Workers.
 *
 * Parameters per v0 spec (§5.7): m=64MB, t=3, p=1.
 */
import { argon2id, argon2Verify } from 'hash-wasm';

const ARGON2_CONFIG = {
  iterations: 3,
  parallelism: 1,
  memorySize: 64 * 1024, // 64 MB in KB
  hashLength: 32,
  outputType: 'encoded' as const,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password,
    salt,
    ...ARGON2_CONFIG,
  });
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encoded });
  } catch {
    return false;
  }
}
