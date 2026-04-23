/**
 * Moderation hooks. v0 ships the posts/personas write-path and leaves the
 * report surface on the shelf:
 *
 * - Posts carry a moderation_state (ok, pending_review, limited, hidden, removed).
 * - Personas carry a moderation_state (ok, restricted, suspended).
 * - Moderators can act on posts and personas via the admin-gated endpoints
 *   (`POST /api/moderation/posts/:id/action` and `.../personas/:id/action`).
 * - Every moderation transition writes a `moderation.post_actioned` or
 *   `moderation.persona_actioned` audit entry inside the same transaction.
 * - Users can file reports via `moderation_report` (schema exists; submitReport
 *   is a v0.5 follow-up — the spec §17 acceptance criterion only requires the
 *   moderator-action path).
 *
 * v0 has no automated classifiers, no hash matching, no reviewer tooling
 * beyond the minimum "hit the endpoint with a reason" surface. Admin
 * identity is an env-var allowlist in this slice (spec §11 defers the
 * roles-table model to v0.5).
 */

/**
 * The closed set of moderation-derived audit actions this module writes.
 * Kept here (rather than in the API types) so other callers that want to
 * filter audit logs by "moderation activity" have a single source to check
 * against. The user-facing action names (`limit`, `hide`, `restrict`, etc.)
 * live in `@porch/types/api` alongside the request schemas.
 */
export const MODERATION_AUDIT_ACTIONS = [
  'moderation.post_actioned',
  'moderation.persona_actioned',
] as const;
export type ModerationAuditAction = (typeof MODERATION_AUDIT_ACTIONS)[number];

export {
  actionPost,
  actionPersona,
  toApiPersona,
  type ActionPostInput,
  type ActionPersonaInput,
  type ModeratorActor,
} from './action.js';

// Implementations TODO (v0.5):
//   export async function submitReport(db, ctx, input): Promise<ModerationReport>
//   export async function listOpenReports(db, opts): Promise<ModerationReport[]>
//   export async function resolveReport(db, adminCtx, reportId, resolution): Promise<void>
