import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const notificationRoutes = new Hono<AppBindings>();

notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', (c) => c.json({ todo: 'list notifications' }, 501));
notificationRoutes.post('/read', (c) => c.json({ todo: 'mark-read' }, 501));
notificationRoutes.post('/dismiss', (c) => c.json({ todo: 'dismiss' }, 501));
