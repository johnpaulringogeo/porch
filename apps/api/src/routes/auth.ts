import { Hono } from 'hono';
import type { AppBindings } from '../bindings.js';

/**
 * Auth routes. Skeleton in v0 — implementations land in the auth-routes commit.
 *
 *   POST /signup
 *   POST /login
 *   POST /refresh
 *   POST /logout
 *   POST /verify-email
 *   POST /request-password-reset
 *   POST /reset-password
 */
export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/signup', (c) => c.json({ todo: 'signup' }, 501));
authRoutes.post('/login', (c) => c.json({ todo: 'login' }, 501));
authRoutes.post('/refresh', (c) => c.json({ todo: 'refresh' }, 501));
authRoutes.post('/logout', (c) => c.json({ todo: 'logout' }, 501));
authRoutes.post('/verify-email', (c) => c.json({ todo: 'verify-email' }, 501));
authRoutes.post('/request-password-reset', (c) => c.json({ todo: 'request-password-reset' }, 501));
authRoutes.post('/reset-password', (c) => c.json({ todo: 'reset-password' }, 501));
