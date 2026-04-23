import { and, desc, eq, lt, or } from 'drizzle-orm';
import { auditLog, type Database } from '@porch/db';
import type { AuditEntry } from '@porch/types/domain';

/**
 * Read side of the audit log — paginated list of entries tied to a single
 * account. Write side lives in `./index.ts` (`recordAudit`); see spec §7.7
 * and §17 AC #7 for the product surface.
 *
 * Access rule: the op only accepts an `accountId` and filters the query by
 * `audit_log.account_id = accountId`. Rows with a null account_id (system
 * events) are never returned here — they belong to an admin-scoped view we
 * haven't built yet. The route layer verifies the caller owns the accountId
 * it passes in; enforcing it here too would be defence-in-depth but also
 * makes this op harder to reuse from future exports/cron jobs where the
 * "caller" abstraction doesn't apply, so we leave it at the route.
 */

// ── Cursor codec ───────────────────────────────────────────────────────────

/**
 * Opaque base64-encoded keyset cursor. `{ createdAt, id }` mirrors the
 * ordering of the query — desc by `createdAt` with `id` as the deterministic
 * tie-breaker — so decoding and re-encoding a cursor never changes the
 * semantics of "give me the next page".
 */
export interface AuditCursor {
  createdAt: string; // ISO timestamp
  id: string;
}

export function encodeCursor(c: AuditCursor): string {
  return btoa(JSON.stringify(c));
}

export function decodeCursor(raw: string): AuditCursor | null {
  try {
    const decoded = JSON.parse(atob(raw)) as AuditCursor;
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── Listing ────────────────────────────────────────────────────────────────

export interface ListAccountAuditParams {
  accountId: string;
  limit: number;
  cursor?: AuditCursor;
}

export interface ListAccountAuditResult {
  entries: AuditEntry[];
  nextCursor: string | null;
}

/**
 * Fetch a page of audit entries for `accountId`, newest first.
 *
 * Fetches `limit + 1` rows and slices off the overflow row to set
 * `nextCursor` — same pattern as the notifications and feed listing ops, so
 * callers that have used those already know the contract. When the page is
 * the last one, `nextCursor` is null.
 */
export async function listAccountAudit(
  db: Database,
  params: ListAccountAuditParams,
): Promise<ListAccountAuditResult> {
  const { accountId, limit, cursor } = params;

  const mine = eq(auditLog.accountId, accountId);
  const conditions = cursor
    ? and(
        mine,
        or(
          lt(auditLog.createdAt, new Date(cursor.createdAt)),
          and(
            eq(auditLog.createdAt, new Date(cursor.createdAt)),
            lt(auditLog.id, cursor.id),
          ),
        ),
      )
    : mine;

  const rows = await db
    .select()
    .from(auditLog)
    .where(conditions)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
      : null;

  return {
    entries: page.map(toApiAuditEntry),
    nextCursor,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

type AuditRow = typeof auditLog.$inferSelect;

/**
 * DB row → API-safe `AuditEntry`. Stringifies the timestamp and normalises
 * the `metadata` JSONB column to `Record<string, unknown> | null` — the DB
 * type is declared as `jsonb` which Drizzle surfaces as `unknown`, so we
 * narrow here once instead of in every caller.
 */
export function toApiAuditEntry(row: AuditRow): AuditEntry {
  const metadata = row.metadata as Record<string, unknown> | null;
  return {
    id: row.id,
    action: row.action,
    accountId: row.accountId,
    personaId: row.personaId,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: metadata ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}
