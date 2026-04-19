import type { MiddlewareHandler } from 'hono';
import { createDatabase } from '@porch/db';
import type { AppBindings } from '../bindings.js';

/**
 * Attach a Drizzle DB handle to the request context. Reuses a connection
 * factory per request — Workers pools at the runtime level via fetchConnectionCache.
 */
export const dbMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const db = createDatabase({
    databaseUrl: c.env.DATABASE_URL,
    // Default to neon in Workers; node script (server.node.ts) overrides at boot.
    driver: 'neon',
  });
  c.set('db', db);
  await next();
};
