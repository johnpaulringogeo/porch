import { Hono } from 'hono';
import type { Context } from 'hono';
import { ModerationOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  PersonaModerationActionRequest,
  PostModerationActionRequest,
  type PersonaModerationActionResponse,
  type PostModerationActionResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Moderation routes.
 *
 *   POST /api/moderation/posts/:id/action       admin — mutate post state
 *   POST /api/moderation/personas/:id/action    admin — mutate persona state
 *   POST /api/moderation/reports                any auth'd user — 501 stub in v0
 *
 * Admin-gated endpoints go through `requireAuth → requireAdmin`. The
 * `requireAdmin` middleware is env-var-driven in v0 (PORCH_ADMIN_ACCOUNT_IDS);
 * spec §11 defers the roles-table model to v0.5, so we don't pretend there's
 * a richer identity system here.
 *
 * Reports are a v0.5 follow-up: the audit criterion in §17 only requires
 * moderators to *act*, not for users to report. Keeping the URL reserved so
 * the client-side report affordance (when we build it) can post to the final
 * path from day one.
 */
export const moderationRoutes = new Hono<AppBindings>();

moderationRoutes.use('*', requireAuth);

// ── User-facing report ────────────────────────────────────────────────────

moderationRoutes.post('/reports', (c) =>
  c.json({ todo: 'file report — lands in v0.5 alongside reviewer tools' }, 501),
);

// ── Admin actions ─────────────────────────────────────────────────────────

/**
 * Apply a moderator action to a post. Body: `{ action, reason }`.
 *
 * The response echoes the updated post so the admin UI / CLI has the new
 * moderation state without a follow-up read. The viewer-facing endpoints
 * (GET /api/posts/:id, feeds, profile lists) will reflect the state on the
 * next fetch — no cache busting is needed because the rows are read fresh.
 */
moderationRoutes.post('/posts/:id/action', requireAdmin, async (c) => {
  const actor = requireActor(c);
  const postId = c.req.param('id');
  if (!postId) {
    throw new PorchError(ErrorCode.BadRequest, 'Missing post id');
  }
  const body = PostModerationActionRequest.parse(await c.req.json());

  const { ipAddress, userAgent } = clientInfo(c);
  const post = await ModerationOps.actionPost(
    c.var.db,
    {
      accountId: actor.accountId,
      personaId: actor.personaId,
      ipAddress,
      userAgent,
    },
    {
      postId,
      action: body.action,
      reason: body.reason,
    },
  );

  const payload: PostModerationActionResponse = { post };
  return c.json(payload);
});

/**
 * Apply a moderator action to a persona. Body: `{ action, reason, durationDays? }`.
 *
 * `durationDays` is recorded on the audit row for suspension actions but is
 * not enforced in v0 — the scheduled-job runner that would auto-reinstate
 * lands in v0.5. Including it in the request schema now lets clients adopt
 * the final contract early.
 */
moderationRoutes.post('/personas/:id/action', requireAdmin, async (c) => {
  const actor = requireActor(c);
  const personaId = c.req.param('id');
  if (!personaId) {
    throw new PorchError(ErrorCode.BadRequest, 'Missing persona id');
  }
  const body = PersonaModerationActionRequest.parse(await c.req.json());

  const { ipAddress, userAgent } = clientInfo(c);
  const persona = await ModerationOps.actionPersona(
    c.var.db,
    {
      accountId: actor.accountId,
      personaId: actor.personaId,
      ipAddress,
      userAgent,
    },
    {
      personaId,
      action: body.action,
      reason: body.reason,
      durationDays: body.durationDays,
    },
  );

  const payload: PersonaModerationActionResponse = { persona };
  return c.json(payload);
});

// ── Legacy /admin/* aliases ───────────────────────────────────────────────
//
// The pre-v0 scaffold stubbed POST /admin/posts/:id/hide and similar. The
// spec-final paths above are `POST /posts/:id/action` / `POST /personas/:id/action`
// with the verb in the body, which generalises better as the action set
// grows. Keep the old paths returning 410 Gone (rather than 501) so clients
// that still call them get a clear "moved, not missing" signal.

function gone(c: Context<AppBindings>, newPath: string) {
  return c.json(
    {
      error: {
        code: ErrorCode.BadRequest,
        message: `Endpoint moved. Use ${newPath} with { action, reason }.`,
      },
    },
    410,
  );
}

moderationRoutes.get('/admin/reports', (c) =>
  c.json({ todo: 'list reports (admin) — deferred to v0.5' }, 501),
);
moderationRoutes.post('/admin/posts/:id/hide', (c) =>
  gone(c, 'POST /api/moderation/posts/:id/action'),
);
moderationRoutes.post('/admin/posts/:id/restore', (c) =>
  gone(c, 'POST /api/moderation/posts/:id/action'),
);
moderationRoutes.post('/admin/personas/:id/restrict', (c) =>
  gone(c, 'POST /api/moderation/personas/:id/action'),
);

// ── Helpers ───────────────────────────────────────────────────────────────

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}

/**
 * Best-effort client-IP / user-agent extraction. Mirrors the helper in
 * personas.ts / contacts.ts / account.ts — lift to a shared util once a
 * fifth route needs it; for now the duplication keeps each route file
 * standalone.
 */
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
