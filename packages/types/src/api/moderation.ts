import { z } from 'zod';
import type { Post, Persona } from '../domain/index.js';

/**
 * Moderator-only action endpoints — spec §7.8.
 *
 *   POST /api/moderation/posts/:id/action
 *   POST /api/moderation/personas/:id/action
 *
 * Both are gated by the `requireAdmin` middleware (env-var allowlist in v0
 * per spec §11 deferral). The endpoints mutate moderation_state +
 * moderation_reason on the subject and append a moderation.post_actioned /
 * moderation.persona_actioned audit entry.
 *
 * The `reason` string is always required — including for 'restore'. We
 * want the audit log to have something explaining *why* a prior action was
 * reversed, not just that it was; leaving it optional makes that record
 * meaningfully worse for transparency reporting.
 */

// ── Post actions ──────────────────────────────────────────────────────────

/**
 * Actions applicable to a post. Mapping to resulting `moderationState`:
 *
 *   limit    → 'limited'  (still visible in feeds/profile, UI swaps the
 *                          body for a reveal affordance)
 *   hide     → 'hidden'   (removed from feeds, replacement block on detail)
 *   remove   → 'removed'  (404 to non-authors; detail page explains to
 *                          author)
 *   restore  → 'ok'       (moderation reason cleared alongside the state)
 *
 * `pending_review` is not exposed as an action here — it's a queue marker
 * automated flows use; v0 has no automated flow, so the column stays
 * effectively write-only by internal tools.
 */
export const PostModerationAction = {
  Limit: 'limit',
  Hide: 'hide',
  Remove: 'remove',
  Restore: 'restore',
} as const;
export type PostModerationAction =
  (typeof PostModerationAction)[keyof typeof PostModerationAction];

export const PostModerationActionRequest = z.object({
  action: z.enum([
    PostModerationAction.Limit,
    PostModerationAction.Hide,
    PostModerationAction.Remove,
    PostModerationAction.Restore,
  ]),
  /**
   * Human-readable explanation. Min 1 so operators can't accidentally
   * write a blank reason; max 1000 to fit typical policy-citation text
   * without inviting a novel.
   */
  reason: z.string().min(1).max(1000),
});
export type PostModerationActionRequest = z.infer<
  typeof PostModerationActionRequest
>;

export interface PostModerationActionResponse {
  post: Post;
}

// ── Persona actions ───────────────────────────────────────────────────────

/**
 * Actions applicable to a persona. Mapping to resulting `moderationState`:
 *
 *   restrict → 'restricted'  (persona can still read but not post/comment;
 *                             enforced in the write routes)
 *   suspend  → 'suspended'   (persona hidden from public views; login
 *                             blocked at the auth layer for the associated
 *                             account when every persona is suspended)
 *   restore  → 'ok'
 *
 * `durationDays` is an advisory field recorded on the audit entry for
 * `suspend` — v0 has no scheduled job runner to auto-reinstate, so the
 * expiry is not enforced. Including the field now means the inbound shape
 * doesn't need a migration when the runner ships in v0.5.
 */
export const PersonaModerationAction = {
  Restrict: 'restrict',
  Suspend: 'suspend',
  Restore: 'restore',
} as const;
export type PersonaModerationAction =
  (typeof PersonaModerationAction)[keyof typeof PersonaModerationAction];

export const PersonaModerationActionRequest = z.object({
  action: z.enum([
    PersonaModerationAction.Restrict,
    PersonaModerationAction.Suspend,
    PersonaModerationAction.Restore,
  ]),
  reason: z.string().min(1).max(1000),
  /**
   * Advisory expiry for 'suspend'. Ignored on other actions. Not enforced
   * in v0 (no scheduled job); recorded on the audit row as metadata.
   */
  durationDays: z.coerce.number().int().positive().max(365).optional(),
});
export type PersonaModerationActionRequest = z.infer<
  typeof PersonaModerationActionRequest
>;

export interface PersonaModerationActionResponse {
  persona: Persona;
}
