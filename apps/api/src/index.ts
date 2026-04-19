import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { AppBindings } from './bindings.js';
import { corsMiddleware } from './middleware/cors.js';
import { dbMiddleware } from './middleware/db.js';
import { errorHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { personaRoutes } from './routes/personas.js';
import { contactRoutes } from './routes/contacts.js';
import { postRoutes } from './routes/posts.js';
import { feedRoutes } from './routes/feed.js';
import { notificationRoutes } from './routes/notifications.js';
import { moderationRoutes } from './routes/moderation.js';
import { accountRoutes } from './routes/account.js';

/**
 * Hono app — runs unchanged on Cloudflare Workers and on Node (via the
 * @hono/node-server adapter in server.node.ts).
 */
export function createApp() {
  const app = new Hono<AppBindings>();

  app.use('*', logger());
  app.use('*', async (c, next) => {
    return corsMiddleware(c.env.WEB_ORIGIN)(c, next);
  });
  app.use('*', dbMiddleware);

  app.onError(errorHandler);

  app.route('/api/health', healthRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/personas', personaRoutes);
  app.route('/api/contacts', contactRoutes);
  app.route('/api/posts', postRoutes);
  app.route('/api/feed', feedRoutes);
  app.route('/api/notifications', notificationRoutes);
  app.route('/api/moderation', moderationRoutes);
  app.route('/api/account', accountRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
  );

  return app;
}

const app = createApp();
export default app;
