import type { Database } from '@porch/db';

/**
 * Request-scoped context threaded through service calls.
 *
 * In v0 this is built by the API layer per request. It carries the DB handle,
 * the active actor (account + persona IDs), and env-derived secrets. We keep
 * it plain rather than DI-heavy — explicit beats magical.
 */
export interface PorchContext {
  db: Database;
  env: PorchEnv;
  actor?: Actor;
  /** Request IP — used for audit logging. */
  ipAddress?: string;
  /** Request User-Agent — used for audit logging. */
  userAgent?: string;
}

export interface PorchEnv {
  /** Publishable host, e.g. 'porch.example' or 'localhost%3A3000'. */
  porchHost: string;
  /** 32-byte AES-256-GCM key (base64). */
  personaKeyEncryptionKey: string;
  /** HS256 JWT signing key (base64). */
  jwtSigningKey: string;
  /** Node or 'edge' — affects which DB driver and password hasher we use. */
  runtime: 'node' | 'edge';
}

export interface Actor {
  accountId: string;
  personaId: string;
  username: string;
  did: string;
}
