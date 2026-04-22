import { Hono } from 'hono';
import type { Context } from 'hono';
import { AuditOps, PostOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  CreatePostRequest,
  EditPostRequest,
  FeedQuery,
  type CreatePostResponse,
  type EditPostResponse,
  type GetPostResponse,
  type LikePostResponse,
  type ListMyPostsResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Post routes.
 *
 *   GET    /mine              list my own posts (paginated)
 *   POST   /                   create a Home-mode post
 *   GET    /:id                read a post (visibility enforced)
 *   PATCH  /:id                edit a post (author-only, content-only)
 *   DELETE /:id                soft-delete a post (author-only)
 *
 * All routes require auth. Validation/invariants live in @porch/core/post;
 * this layer parses input, calls core, and writes audit entries.
 */
export const postRoutes = new Hono<AppBindings>();

postRoutes.use('*', requireAuth);

// ── Read ───────────────────────────────────────────────────────────────────

postRoutes.get('/mine', async (c) => {
  const actor = requireActor(c);
  const parsed = FeedQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  const result = await PostOps.listMyPosts(
    c.var.db,
    { personaId: actor.personaId },
    { cursor: parsed.cursor, limit: parsed.limit },
  );
  const payload: ListMyPostsResponse = {
    posts: result.posts,
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

postRoutes.get('/:id', async (c) => {
  const actor = requireActor(c);
  const result = await PostOps.getPost(
    c.var.db,
    { personaId: actor.personaId },
    c.req.param('id'),
  );
  const payload: GetPostResponse = {
    post: result.post,
    audiencePersonas: result.audiencePersonas,
    likeSummary: result.likeSummary,
  };
  return c.json(payload);
});

// ── Mutations ──────────────────────────────────────────────────────────────

postRoutes.post('/', async (c) => {
  const actor = requireActor(c);
  const body = CreatePostRequest.parse(await c.req.json());

  const post = await PostOps.createPost(
    c.var.db,
    { personaId: actor.personaId },
    {
      mode: body.mode,
      content: body.content,
      audienceMode: body.audienceMode,
      audiencePersonaIds: body.audiencePersonaIds,
    },
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'post.create',
    entityType: 'post',
    entityId: post.id,
    metadata: {
      mode: post.mode,
      audienceMode: post.audienceMode,
      audienceSize: body.audiencePersonaIds?.length ?? null,
    },
    ipAddress,
    userAgent,
  });

  const payload: CreatePostResponse = { post };
  return c.json(payload, 201);
});

postRoutes.patch('/:id', async (c) => {
  const actor = requireActor(c);
  const body = EditPostRequest.parse(await c.req.json());

  const post = await PostOps.editPost(
    c.var.db,
    { personaId: actor.personaId },
    c.req.param('id'),
    body.content,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'post.edit',
    entityType: 'post',
    entityId: post.id,
    ipAddress,
    userAgent,
  });

  const payload: EditPostResponse = { post };
  return c.json(payload);
});

postRoutes.delete('/:id', async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');

  await PostOps.deletePost(c.var.db, { personaId: actor.personaId }, postId);

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'post.delete',
    entityType: 'post',
    entityId: postId,
    ipAddress,
    userAgent,
  });

  return c.body(null, 204);
});

postRoutes.post('/:id/like', async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');

  const summary = await PostOps.togglePostLike(
    c.var.db,
    { personaId: actor.personaId },
    postId,
  );

  // Audit both directions of the toggle. Engagement is a low-volume signal
  // for now and the audit log is the only durable trail of who liked what
  // and when. Action name carries the resulting state.
  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: summary.liked ? 'post.like' : 'post.unlike',
    entityType: 'post',
    entityId: postId,
    ipAddress,
    userAgent,
  });

  const payload: LikePostResponse = { likeSummary: summary };
  return c.json(payload);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}

function clientInfo(c: Context<AppBindings>): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  const cf = c.req.header('cf-connecting-ip');
  const xff = c.req.header('x-forwarded-for');
  const ipAddress = cf ?? xff?.split(',')[0]?.trim() ?? undefined;
  const userAgent = c.req.header('user-agent') ?? undefined;
  return { ipAddress, userAgent };
}
