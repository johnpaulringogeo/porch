import { Hono } from 'hono';
import type { Context } from 'hono';
import { AuditOps, CommentOps, PostOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  CreateCommentRequest,
  CreatePostRequest,
  EditPostRequest,
  FeedQuery,
  ListCommentsQuery,
  type CreateCommentResponse,
  type CreatePostResponse,
  type DeleteCommentResponse,
  type EditPostResponse,
  type GetPostResponse,
  type LikePostResponse,
  type ListCommentsResponse,
  type ListMyPostsResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Post routes.
 *
 *   GET    /mine                        list my own posts (paginated)
 *   POST   /                             create a Home-mode post
 *   GET    /:id                          read a post (visibility enforced)
 *   PATCH  /:id                          edit a post (author-only, content-only)
 *   DELETE /:id                          soft-delete a post (author-only)
 *   POST   /:id/like                     toggle like on a post
 *   POST   /:id/comments                 create a comment on a post
 *   GET    /:id/comments                 list comments on a post (paginated)
 *   DELETE /:id/comments/:commentId      soft-delete a comment (author-only)
 *
 * All routes require auth. Validation/invariants live in @porch/core/post
 * and @porch/core/comment; this layer parses input, calls core, and writes
 * audit entries.
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
    likeSummaries: result.likeSummaries,
    commentSummaries: result.commentSummaries,
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
    commentSummary: result.commentSummary,
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

// ── Comments ───────────────────────────────────────────────────────────────

postRoutes.post('/:id/comments', async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');
  const body = CreateCommentRequest.parse(await c.req.json());

  const result = await CommentOps.createComment(
    c.var.db,
    { personaId: actor.personaId },
    { postId, content: body.content },
  );

  // Audit each create — mirrors posts. Low-volume for v0 and the trail is
  // useful for moderation review; we store the comment id + parent post id
  // on the entry so review queries can go either direction.
  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'comment.create',
    entityType: 'comment',
    entityId: result.comment.id,
    metadata: { postId },
    ipAddress,
    userAgent,
  });

  const payload: CreateCommentResponse = {
    comment: result.comment,
    commentSummary: result.commentSummary,
  };
  return c.json(payload, 201);
});

postRoutes.get('/:id/comments', async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');
  const parsed = ListCommentsQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const result = await CommentOps.listComments(
    c.var.db,
    { personaId: actor.personaId },
    { postId, cursor: parsed.cursor, limit: parsed.limit },
  );

  const payload: ListCommentsResponse = {
    comments: result.comments,
    commentSummary: result.commentSummary,
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

postRoutes.delete('/:id/comments/:commentId', async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');
  const commentId = c.req.param('commentId');

  const result = await CommentOps.deleteComment(
    c.var.db,
    { personaId: actor.personaId },
    { postId, commentId },
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'comment.delete',
    entityType: 'comment',
    entityId: commentId,
    metadata: { postId },
    ipAddress,
    userAgent,
  });

  const payload: DeleteCommentResponse = { commentSummary: result.commentSummary };
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
