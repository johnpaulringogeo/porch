import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const contactRoutes = new Hono<AppBindings>();

contactRoutes.use('*', requireAuth);

contactRoutes.get('/', (c) => c.json({ todo: 'list contacts' }, 501));
contactRoutes.get('/requests', (c) => c.json({ todo: 'list incoming requests' }, 501));
contactRoutes.get('/requests/outgoing', (c) => c.json({ todo: 'list outgoing requests' }, 501));
contactRoutes.post('/requests', (c) => c.json({ todo: 'create request' }, 501));
contactRoutes.post('/requests/:id/respond', (c) => c.json({ todo: 'respond to request' }, 501));
contactRoutes.post('/requests/:id/cancel', (c) => c.json({ todo: 'cancel request' }, 501));
contactRoutes.delete('/:personaId', (c) => c.json({ todo: 'remove contact' }, 501));
