import { Hono } from 'hono';
import type { Context } from 'hono';
import { NotificationOps, AuditOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  DismissNotificationsRequest,
  ListNotificationsQuery,
  MarkNotificationsReadRequest,
  type ListNotificationsResponse,
  type NotificationWriteResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Notification routes.
 *
 *   GET    /            list (paginated, excludes dismissed by default)
 *   POST   /read        mark a set (or all) as read
 *   POST   /dismiss     dismiss a set (or all)
 *
 * All routes require auth. Writes record an audit entry so we have a trail
 * of which actor cleared what, even though the rows themselves are scoped
 * to a single persona.
 */
export const notificationRoutes = new Hono<AppBindings>();

notificationRoutes.use('*', requireAuth);

// ── List ───────────────────────────────────────────────────────────────────

notificationRoutes.get('/', async (c) => {
  const actor = requireActor(c);
  const parsed = ListNotificationsQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
    includeDismissed: c.req.query('includeDismissed'),
  });

  const decodedCursor = parsed.cursor
    ? NotificationOps.decodeCursor(parsed.cursor)
    : null;

  const result = await NotificationOps.listNotifications(c.var.db, {
    recipientPersonaId: actor.personaId,
    limit: parsed.limit,
    cursor: decodedCursor ?? undefined,
    includeDismissed: parsed.includeDismissed,
  });

  const payload: ListNotificationsResponse = {
    notifications: result.notifications,
    nextCursor: result.nextCursor,
    unreadCount: result.unreadCount,
  };
  return c.json(payload);
});

// ── Read / dismiss ─────────────────────────────────────────────────────────

notificationRoutes.post('/read', async (c) => {
  const actor = requireActor(c);
  const body = MarkNotificationsReadRequest.parse(await c.req.json());

  const result = await NotificationOps.markRead(
    c.var.db,
    { personaId: actor.personaId },
    { ids: body.ids, all: body.all },
  );

  // Only audit if something actually changed — a no-op clear doesn't deserve
  // a row. Keeps the audit log interpretable.
  if (result.updated > 0) {
    const { ipAddress, userAgent } = clientInfo(c);
    void AuditOps.recordAudit(c.var.db, {
      accountId: actor.accountId,
      personaId: actor.personaId,
      action: 'notification.read',
      entityType: 'notification',
      entityId: body.all ? 'all' : (body.ids?.[0] ?? 'unknown'),
      metadata: {
        scope: body.all ? 'all' : 'ids',
        count: result.updated,
      },
      ipAddress,
      userAgent,
    });
  }

  const payload: NotificationWriteResponse = {
    updated: result.updated,
    unreadCount: result.unreadCount,
  };
  return c.json(payload);
});

notificationRoutes.post('/dismiss', async (c) => {
  const actor = requireActor(c);
  const body = DismissNotificationsRequest.parse(await c.req.json());

  const result = await NotificationOps.dismiss(
    c.var.db,
    { personaId: actor.personaId },
    { ids: body.ids, all: body.all },
  );

  if (result.updated > 0) {
    const { ipAddress, userAgent } = clientInfo(c);
    void AuditOps.recordAudit(c.var.db, {
      accountId: actor.accountId,
      personaId: actor.personaId,
      action: 'notification.dismiss',
      entityType: 'notification',
      entityId: body.all ? 'all' : (body.ids?.[0] ?? 'unknown'),
      metadata: {
        scope: body.all ? 'all' : 'ids',
        count: result.updated,
      },
      ipAddress,
      userAgent,
    });
  }

  const payload: NotificationWriteResponse = {
    updated: result.updated,
    unreadCount: result.unreadCount,
  };
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

/**
 * Mirrors the helper in personas.ts/contacts.ts — duplicated intentionally;
 * lifts to a shared helper when a fourth route needs it.
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
