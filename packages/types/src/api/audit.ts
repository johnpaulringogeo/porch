import { z } from 'zod';
import type { AuditEntry } from '../domain/audit.js';

/**
 * GET /api/account/audit
 *
 * Returns the authenticated account's own audit trail — every row in
 * `audit_log` where `account_id = caller.accountId`. This is the per-user
 * read path; admin-scoped audit views (cross-account filtering, action-type
 * slicing for moderation review) are deferred to v0.5.
 *
 *   ?cursor   opaque base64 keyset cursor of `{createdAt, id}` matching the
 *             feed / notifications codec. Desc order on (createdAt, id) so
 *             the caller walks from "newest" backwards in time.
 *   ?limit    1..100, default 50
 *
 * The caller only sees entries tied to *their own* account_id — we never
 * expose system-level or cross-account rows here. That guarantee is enforced
 * in the core op, not in the route layer, because the same safety rule
 * applies if this op ever gets called from a cron/export surface.
 */
export const ListAccountAuditQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAccountAuditQuery = z.infer<typeof ListAccountAuditQuery>;

export interface ListAccountAuditResponse {
  entries: AuditEntry[];
  /** Opaque base64 cursor for the next page. Null if at end. */
  nextCursor: string | null;
}

/** Re-export so `@porch/types/api` consumers can import the row shape flatly. */
export type { AuditEntry };
