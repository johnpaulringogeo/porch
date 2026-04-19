import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppBindings } from '../bindings.js';

export const healthRoutes = new Hono<AppBindings>();

/**
 * Liveness — process is up.
 */
healthRoutes.get('/', (c) => {
  return c.json({ status: 'ok', service: 'porch-api', version: '0.0.0' });
});

/**
 * Readiness — dependencies reachable. DB ping with a 1-second timeout.
 */
healthRoutes.get('/ready', async (c) => {
  const db = c.get('db');
  try {
    await db.execute(sql`select 1 as ok`);
    return c.json({ status: 'ready' });
  } catch (err) {
    console.error('readiness-check-failed', err);
    return c.json({ status: 'degraded', reason: 'db-unreachable' }, 503);
  }
});
