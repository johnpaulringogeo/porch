import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database =
  | ReturnType<typeof drizzleHttp<typeof schema>>
  | ReturnType<typeof drizzlePostgres<typeof schema>>;

interface CreateClientOptions {
  databaseUrl: string;
  /**
   * 'neon' uses the @neondatabase/serverless HTTP driver — works on Cloudflare
   * Workers and other edge runtimes. 'postgres-js' is a TCP driver for Node.
   * Default: auto-detect from URL host.
   */
  driver?: 'neon' | 'postgres-js';
}

/**
 * Construct a Drizzle database client. Picks the right driver for the runtime.
 *
 * - On Cloudflare Workers / edge: pass driver: 'neon' (uses HTTP, no TCP).
 * - On Node.js (local dev, scripts, migrations): pass driver: 'postgres-js'.
 */
export function createDatabase(options: CreateClientOptions): Database {
  const { databaseUrl } = options;
  const driver = options.driver ?? autodetectDriver(databaseUrl);

  if (driver === 'neon') {
    // The neon-http driver works against any Postgres-compatible URL that Neon
    // accepts; for non-Neon Postgres use 'postgres-js'.
    neonConfig.fetchConnectionCache = true;
    const sql: NeonQueryFunction<false, false> = neon(databaseUrl);
    return drizzleHttp(sql, { schema });
  }

  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzlePostgres(client, { schema });
}

function autodetectDriver(url: string): 'neon' | 'postgres-js' {
  return url.includes('.neon.tech') ? 'neon' : 'postgres-js';
}

export { schema };
