/**
 * Append-only record of a state-changing action on the system, projected into
 * a JSON-safe shape for API consumers. Schema-side the row lives in
 * `audit_log` (see `@porch/db/schema/audit.ts`) and is written via
 * `AuditOps.recordAudit` from the core package.
 *
 * `action` follows `<entity>.<verb>` naming — e.g. 'auth.login',
 * 'auth.signup', 'post.created', 'persona.switch', 'account.deletion_requested'.
 * The string is free-form by design: v0 fixes a vocabulary in the writer call
 * sites rather than baking it into an enum, so new actions can be added
 * without a schema migration. The /settings/account/activity UI maps known
 * actions to friendly labels and falls back to the raw string for unknowns.
 *
 * `metadata` is whatever the writer chose to stash as context. It's opaque
 * to the read path — the UI should not rely on specific keys existing; if
 * a given action needs a rendered field, the mapping lives in the
 * action-label table, not in parsing the blob.
 *
 * `ipAddress` and `userAgent` are best-effort — writers at the edge-worker
 * layer have them, but internal / system-initiated audit entries often do
 * not. They're surfaced on the activity page as hover-only detail so the
 * list stays scannable.
 */
export interface AuditEntry {
  id: string;
  /** `<entity>.<verb>`. Free-form; see module comment. */
  action: string;
  /** Non-null when the row is tied to a specific account; null for system-level entries. */
  accountId: string | null;
  /** Non-null when the action was performed under a specific persona context. */
  personaId: string | null;
  /** Type of the entity the action targeted (e.g. 'post', 'persona'). Null when the action is not entity-scoped. */
  entityType: string | null;
  /** ID of the targeted entity. Null when entityType is null. */
  entityId: string | null;
  /** Writer-supplied context blob. Shape varies by action; the read path treats it as opaque. */
  metadata: Record<string, unknown> | null;
  /** Best-effort client IP captured at write time. */
  ipAddress: string | null;
  /** Best-effort user-agent string captured at write time. */
  userAgent: string | null;
  /** ISO timestamp. Ordering of the list endpoint is desc by (createdAt, id). */
  createdAt: string;
}
