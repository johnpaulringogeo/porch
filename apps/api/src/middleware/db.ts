import type { MiddlewareHandler } from 'hono';
import { createDatabase } from '@porch/db';
import type { AppBindings } from '../bindings.js';

/**
 * Attach a Drizzle DB handle to the request context.
 *
 * On Node we use the postgres-js TCP driver — it supports multi-statement
 * transactions, which createPersona and other write paths rely on.
 *
 * On Cloudflare Workers we use @neondatabase/serverless over HTTP. That
 * driver does NOT support transactions — any code path that needs
 * transactional guarantees on Workers must either use Neon's Pool (WebSocket)
 * or refactor to a single-statement CTE. See packages/db/src/client.ts.
 */
export const dbMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const driver = c.env.PORCH_RUNTIME === 'node' ? 'postgres-js' : 'neon';
  const db = createDatabase({
    databaseUrl: c.env.DATABASE_URL,
    driver,
  });
  c.set('db', db);
  await next();
};
