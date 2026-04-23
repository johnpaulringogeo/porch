import { auditLog, type Database } from '@porch/db';

/**
 * Writer-facing input for `recordAudit`. All fields other than `action` are
 * optional — the caller supplies whatever context it has, and the DB row
 * lands with `null` for anything omitted. Kept distinct from the
 * `@porch/types` `AuditEntry` (the API read shape) so we don't blur the
 * semantics: this is "what you hand to the writer" and is closer to a
 * partial-row DTO, while `AuditEntry` is "what the caller reads back" and
 * always has `id` / `createdAt` populated.
 */
export interface RecordAuditInput {
  accountId?: string | null;
  personaId?: string | null;
  /** `<entity>.<verb>`, e.g. 'auth.signup', 'post.create', 'persona.switch'. */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append an audit log entry. Append-only by convention in v0; v1 enforces this
 * with row-level DB permissions. Never fails a request — log and swallow.
 */
export async function recordAudit(db: Database, entry: RecordAuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      accountId: entry.accountId ?? null,
      personaId: entry.personaId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? null) as never,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    // Audit failures are logged out-of-band but never block the request.
    console.error('audit-log-write-failed', err);
  }
}

export {
  listAccountAudit,
  encodeCursor,
  decodeCursor,
  toApiAuditEntry,
  type AuditCursor,
  type ListAccountAuditParams,
  type ListAccountAuditResult,
} from './list.js';
