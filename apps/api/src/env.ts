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
