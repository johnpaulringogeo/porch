import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const feedRoutes = new Hono<AppBindings>();

feedRoutes.use('*', requireAuth);

feedRoutes.get('/home', (c) => c.json({ todo: 'home feed (read-fanout)' }, 501));
