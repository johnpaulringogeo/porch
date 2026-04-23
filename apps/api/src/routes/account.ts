import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { AccountOps, AuditOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  ListAccountAuditQuery,
  type CancelAccountDeletionResponse,
  type GetAccountMeResponse,
  type ListAccountAuditResponse,
  type RequestAccountDeletionResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Account-level routes. Everything here acts on the signed-in *account*
 * (the login identity) rather than the currently active persona.
 *
 *   GET  /me                 account info + deletion-grace state
 *   POST /delete             request deletion (starts 30-day grace)
 *   POST /delete/cancel      cancel pending deletion
 *   GET  /audit              paginated activity log for this account
 *
 * The data-export endpoint (POST /export) is still a 501 stub; it lands with
 * the scheduled-job runner in v0.5 per spec §18.5.
 */
export const accountRoutes = new Hono<AppBindings>();

const REFRESH_COOKIE = 'porch_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';

accountRoutes.use('*', requireAuth);

// ── Me ─────────────────────────────────────────────────────────────────────

accountRoutes.get('/me', async (c) => {
  const actor = requireActor(c);
  const account = await AccountOps.getAccountMe(c.var.db, actor.accountId);
  const payload: GetAccountMeResponse = { account };
  return c.json(payload);
});

// ── Request deletion ───────────────────────────────────────────────────────

/**
 * Start a 30-day grace period. AccountOps.requestDeletion also revokes every
 * open session on this account — so we clear the refresh cookie on the way
 * out to keep the client from replaying a token the server won't honour.
 *
 * The deletion is reversible up until the grace period ends (a scheduled job
 * will flip status to `deleted` and hard-delete at that point; the job
 * runner lands in v0.5 per spec §18.5). The UI should redirect to a signed-
 * out confirmation page on 200 so the user knows they need to log back in
 * to cancel.
 */
accountRoutes.post('/delete', async (c) => {
  const actor = requireActor(c);
  const db = c.var.db;

  const account = await AccountOps.requestDeletion(db, actor.accountId);

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(db, {
    accountId: actor.accountId,
    action: 'account.deletion_requested',
    entityType: 'account',
    entityId: actor.accountId,
    metadata: { graceEndsAt: account.deletionGraceEndsAt },
    ipAddress,
    userAgent,
  });

  // Kill the refresh cookie (scoped to /api/auth). The access token the
  // client is holding will continue to JWT-verify until it expires, but
  // requireAuth short-circuits deletion_requested accounts so no further
  // call succeeds.
  deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });

  const payload: RequestAccountDeletionResponse = { account };
  return c.json(payload);
});

// ── Cancel deletion ────────────────────────────────────────────────────────

/**
 * Cancel a pending deletion. The user must have logged back in (because the
 * request path revoked their previous sessions), so we already have a fresh
 * session here — no cookie juggling required.
 */
accountRoutes.post('/delete/cancel', async (c) => {
  const actor = requireActor(c);
  const db = c.var.db;

  const account = await AccountOps.cancelDeletion(db, actor.accountId);

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(db, {
    accountId: actor.accountId,
    action: 'account.deletion_cancelled',
    entityType: 'account',
    entityId: actor.accountId,
    ipAddress,
    userAgent,
  });

  const payload: CancelAccountDeletionResponse = { account };
  return c.json(payload);
});

// ── Audit / activity log ───────────────────────────────────────────────────

/**
 * Paginated activity log for the caller's own account. Only rows whose
 * `account_id = actor.accountId` are returned — system-level entries stay
 * invisible here. Newest first, keyset-paginated with an opaque base64
 * cursor so the UI can implement a "load more" affordance without exposing
 * row IDs in the URL.
 *
 * No audit entry is written for reading the audit log — otherwise a settings
 * page visit creates a row that appears on the next refresh, which is noisy
 * and (mildly) recursive.
 */
accountRoutes.get('/audit', async (c) => {
  const actor = requireActor(c);
  const parsed = ListAccountAuditQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const decodedCursor = parsed.cursor
    ? AuditOps.decodeCursor(parsed.cursor)
    : null;

  const result = await AuditOps.listAccountAudit(c.var.db, {
    accountId: actor.accountId,
    limit: parsed.limit,
    cursor: decodedCursor ?? undefined,
  });

  const payload: ListAccountAuditResponse = {
    entries: result.entries,
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

// ── Stubs (post-v0) ────────────────────────────────────────────────────────

accountRoutes.post('/export', (c) => c.json({ todo: 'request data export' }, 501));

// ── Helpers ────────────────────────────────────────────────────────────────

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}

/**
 * Best-effort client-IP / user-agent extraction. Duplicated from auth.ts and
 * personas.ts intentionally to keep route files self-contained; a shared
 * helper lives on the to-do list once a fourth route needs it.
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
