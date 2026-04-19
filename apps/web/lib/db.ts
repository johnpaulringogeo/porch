import { createDatabase, type Database } from '@porch/db';

/**
 * Lazily-constructed singleton so we don't open a Postgres connection during
 * Next's build-time static analysis. In a long-lived Node process this client
 * is reused across requests; on Vercel's serverless functions it's created
 * per cold-start.
 */
let cached: Database | null = null;

export function getDb(): Database {
  if (cached) return cached;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  cached = createDatabase({ databaseUrl });
  return cached;
}
