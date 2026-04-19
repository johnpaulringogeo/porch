import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const accountRoutes = new Hono<AppBindings>();

accountRoutes.use('*', requireAuth);

accountRoutes.get('/', (c) => c.json({ todo: 'me (account)' }, 501));
accountRoutes.post('/export', (c) => c.json({ todo: 'request data export' }, 501));
accountRoutes.post('/delete', (c) => c.json({ todo: 'request deletion (30-day grace)' }, 501));
accountRoutes.post('/delete/cancel', (c) => c.json({ todo: 'cancel deletion' }, 501));
