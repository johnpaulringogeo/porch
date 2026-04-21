import type { MiddlewareHandler } from 'hono';
import { Auth } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import type { AppBindings } from '../bindings.js';

/**
 * Bearer-token middleware. Verifies the access JWT and stashes the actor on
 * the Hono context for downstream handlers.
 *
 * Throws Unauthorized if the token is missing, malformed, expired, or invalid.
 */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();

  try {
    const claims = await Auth.verifyAccessToken(c.env.JWT_SIGNING_KEY, token);
    c.set('actor', {
      accountId: claims.sub,
      personaId: claims.persona,
      username: claims.username,
      did: claims.did,
      sessionId: claims.sid,
    });
  } catch {
    throw new PorchError(ErrorCode.Unauthorized, 'Invalid or expired access token');
  }

  await next();
};
