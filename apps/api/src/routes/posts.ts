import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const postRoutes = new Hono<AppBindings>();

postRoutes.use('*', requireAuth);

postRoutes.post('/', (c) => c.json({ todo: 'create post' }, 501));
postRoutes.get('/:id', (c) => c.json({ todo: 'read post' }, 501));
postRoutes.patch('/:id', (c) => c.json({ todo: 'edit post' }, 501));
postRoutes.delete('/:id', (c) => c.json({ todo: 'delete post' }, 501));
