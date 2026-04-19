import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

export function corsMiddleware(origin: string): MiddlewareHandler {
  return cors({
    origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
}
