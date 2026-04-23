/**
 * Worker environment bindings — populated by wrangler in prod, by process.env
 * via the Node bridge locally.
 */
export interface Env {
  DATABASE_URL: string;
  PERSONA_KEY_ENCRYPTION_KEY: string;
  JWT_SIGNING_KEY: string;
  PORCH_HOST: string;
  WEB_ORIGIN: string;
  /**
   * Which runtime is hosting this request. Defaults to 'edge' (Cloudflare
   * Workers). Node's server.node.ts overrides to 'node' so we can pick a
   * Postgres driver that supports transactions.
   */
  PORCH_RUNTIME?: 'node' | 'edge';
  /**
   * Comma-separated list of account UUIDs permitted to hit moderator-only
   * endpoints (POST /api/moderation/posts/:id/action, etc.). Intentionally
   * env-var-driven for v0 — full admin identity (roles table, admin-grant
   * audit, self-service tooling) is deferred to v0.5 per spec §11. Empty
   * or unset means no admins; every moderation endpoint 403s.
   *
   * Whitespace around commas is tolerated; duplicates and case differences
   * are collapsed in the middleware.
   */
  PORCH_ADMIN_ACCOUNT_IDS?: string;
}

export function readEnv(env: Partial<Env>): Env {
  for (const key of [
    'DATABASE_URL',
    'PERSONA_KEY_ENCRYPTION_KEY',
    'JWT_SIGNING_KEY',
    'PORCH_HOST',
    'WEB_ORIGIN',
  ] as const) {
    if (!env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
  return env as Env;
}
