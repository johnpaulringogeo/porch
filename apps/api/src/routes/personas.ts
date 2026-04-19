import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const personaRoutes = new Hono<AppBindings>();

personaRoutes.use('*', requireAuth);

personaRoutes.get('/', (c) => c.json({ todo: 'list my personas' }, 501));
personaRoutes.post('/', (c) => c.json({ todo: 'create persona' }, 501));
personaRoutes.post('/switch', (c) => c.json({ todo: 'switch persona' }, 501));
personaRoutes.patch('/:personaId', (c) => c.json({ todo: 'update persona' }, 501));
personaRoutes.post('/:personaId/archive', (c) => c.json({ todo: 'archive persona' }, 501));
personaRoutes.get('/:username/profile', (c) => c.json({ todo: 'public profile' }, 501));
