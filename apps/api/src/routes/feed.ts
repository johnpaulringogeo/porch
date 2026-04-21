import { Hono } from 'hono';
import type { Context } from 'hono';
import { FeedOps, PostOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import { FeedQuery, type HomeFeedResponse } from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Feed routes. v0 surfaces a single Home feed — read-fanout over the posts a
 * viewer is a permitted audience of (see core/feed/index.ts for the query).
 *
 * The heavy lifting lives in FeedOps.getHomeFeed; this layer parses cursor +
 * limit, calls the query, and maps rows through toApiPost to strip non-public
 * persona fields before sending.
 */
export const feedRoutes = new Hono<AppBindings>();

feedRoutes.use('*', requireAuth);

feedRoutes.get('/home', async (c) => {
  const actor = requireActor(c);
  const parsed = FeedQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const decodedCursor = parsed.cursor ? FeedOps.decodeCursor(parsed.cursor) : null;
  const result = await FeedOps.getHomeFeed(c.var.db, {
    viewerPersonaId: actor.personaId,
    limit: parsed.limit,
    cursor: decodedCursor ?? undefined,
  });

  const payload: HomeFeedResponse = {
    posts: result.items.map((item) => PostOps.toApiPost(item.post, item.author)),
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}
