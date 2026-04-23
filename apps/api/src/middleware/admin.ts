import type { MiddlewareHandler } from 'hono';
import { ErrorCode, PorchError } from '@porch/types';
import type { AppBindings } from '../bindings.js';

/**
 * Admin gating for moderator-only endpoints. Chains after `requireAuth` —
 * the actor must already be populated on the Hono context, or the request
 * is rejected as unauthenticated.
 *
 * Admin identity in v0 is a comma-separated allowlist in the
 * `PORCH_ADMIN_ACCOUNT_IDS` env var. That's intentionally minimal — full
 * admin identity (roles table, grant audit, self-service tooling) is
 * deferred to v0.5 per spec §11 and the "Admin endpoints require role-check
 * — deferred to v0.5 when admin identity is in place" comment that's been
 * sitting on moderation.ts since the repo scaffold.
 *
 * Why env-var over a DB column in v0:
 *   - no schema migration for a feature the spec explicitly defers
 *   - admin grants become part of the deploy rather than silent runtime
 *     state; there's no "who gave Alice admin" question to answer until
 *     v0.5 ships proper provenance
 *   - rotating / revoking an admin is a redeploy, which is the right
 *     friction for a surface without an audit trail
 *
 * The list is parsed on every request. That's cheap (≤ a handful of IDs)
 * and avoids a module-level cache that would resist hot-reload during
 * dev. If the list ever grows past ~50 entries we can cache per-isolate.
 */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const actor = c.var.actor;
  if (!actor) {
    // Defensive: requireAuth should run first. Surfacing Unauthorized
    // (not Forbidden) keeps the error semantics honest — "you didn't
    // prove who you are", not "you proved it and we said no".
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }

  const allowlist = parseAdminList(c.env.PORCH_ADMIN_ACCOUNT_IDS);
  if (!allowlist.has(actor.accountId.toLowerCase())) {
    // Don't leak that the endpoint exists at a different privilege tier.
    // Forbidden with a generic message is fine — a curious client already
    // knows the URL from the network trace.
    throw new PorchError(
      ErrorCode.Forbidden,
      'This action requires moderator privileges.',
    );
  }

  await next();
};

/**
 * Parse the env value into a set of normalised account IDs. Whitespace is
 * trimmed, empty entries are dropped, duplicates collapse, and we
 * lowercase so a config typo like `UUID` vs `uuid` doesn't lock a legit
 * admin out. Exported for test reach.
 */
export function parseAdminList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
