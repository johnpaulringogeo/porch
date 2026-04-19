/**
 * Moderation hooks. v0 implements the bare skeleton:
 *
 * - Posts carry a moderation_state (ok, pending_review, limited, hidden, removed).
 * - Personas carry a moderation_state (ok, restricted, suspended).
 * - Users can file reports (moderation_report table).
 * - Admin endpoints let a human reviewer transition states.
 *
 * v0 has no automated classifiers, no hash matching, no reviewer tooling beyond
 * a minimal internal admin UI. Every moderation transition writes an audit log.
 *
 * The interfaces below are defined now so that the API layer and the future
 * moderation service can both depend on the same surface.
 */

export const MODERATION_ACTIONS = [
  'post.hide',
  'post.remove',
  'post.limit',
  'post.restore',
  'persona.restrict',
  'persona.suspend',
  'persona.reinstate',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

// Implementations TODO:
//   export async function submitReport(db, ctx, input): Promise<ModerationReport>
//   export async function listOpenReports(db, opts): Promise<ModerationReport[]>
//   export async function actOnReport(db, adminCtx, reportId, action, reason): Promise<void>
//   export async function hidePost(db, adminCtx, postId, reason): Promise<void>
//   export async function restorePost(db, adminCtx, postId): Promise<void>

export {};
