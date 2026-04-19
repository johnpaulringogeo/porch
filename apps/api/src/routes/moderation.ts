import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

export const moderationRoutes = new Hono<AppBindings>();

moderationRoutes.use('*', requireAuth);

/** Any authenticated persona can file a report. */
moderationRoutes.post('/reports', (c) => c.json({ todo: 'file report' }, 501));

// Admin endpoints below require role-check — deferred to v0.5 when admin
// identity is in place. For now the endpoints exist but return 501.
moderationRoutes.get('/admin/reports', (c) => c.json({ todo: 'list reports (admin)' }, 501));
moderationRoutes.post('/admin/posts/:id/hide', (c) =>
  c.json({ todo: 'hide post (admin)' }, 501),
);
moderationRoutes.post('/admin/posts/:id/restore', (c) =>
  c.json({ todo: 'restore post (admin)' }, 501),
);
moderationRoutes.post('/admin/personas/:id/restrict', (c) =>
  c.json({ todo: 'restrict persona (admin)' }, 501),
);
