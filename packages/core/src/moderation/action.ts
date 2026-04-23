import { eq } from 'drizzle-orm';
import { post, persona, auditLog, type Database } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import {
  PersonaModerationState,
  PostModerationState,
  type Persona,
  type Post,
} from '@porch/types/domain';
import {
  PersonaModerationAction,
  PostModerationAction,
} from '@porch/types/api';
import { toApiPost } from '../post/helpers.js';
import { toPublicPersona } from '../contact/helpers.js';

/**
 * Moderator-only ops that mutate post/persona moderation state. Called by
 * the admin-gated endpoints in `apps/api/src/routes/moderation.ts`; see
 * spec §7.8 and §11.
 *
 * Shared contract:
 *   - Every successful action writes a `moderation.post_actioned` or
 *     `moderation.persona_actioned` audit entry within the same transaction
 *     as the state flip, so the audit trail can never miss a transition.
 *   - Actions are idempotent at the row level: re-applying `limit` with a
 *     new reason replaces the reason and bumps `moderated_at`. The audit
 *     log captures every attempt, not just state transitions — the record
 *     of "who tried to do what, when" is more useful than a delta-only log.
 *   - Soft-deleted posts are still actionable. A post the author deleted
 *     can still be `remove`-ed for appeal provenance; the two states are
 *     orthogonal.
 *
 * Authorisation happens in the route layer (`requireAdmin`). Passing the
 * admin's account/persona IDs into the op lets the audit row attribute the
 * action to a specific operator without coupling core to Hono's context.
 */

export interface ModeratorActor {
  /** Admin's account ID — goes on the audit row's `account_id` column. */
  accountId: string;
  /** Admin's active persona, if any. Null when the admin is acting outside a persona context. */
  personaId?: string | null;
  /** Best-effort client IP for the audit row. */
  ipAddress?: string | null;
  /** Best-effort user-agent for the audit row. */
  userAgent?: string | null;
}

// ── Post ──────────────────────────────────────────────────────────────────

/**
 * Map a request action to the resulting `moderation_state` column value.
 * Centralised so the route layer and any future CLI share one mapping.
 */
function postStateForAction(action: PostModerationAction): PostModerationState {
  switch (action) {
    case PostModerationAction.Limit:
      return PostModerationState.Limited;
    case PostModerationAction.Hide:
      return PostModerationState.Hidden;
    case PostModerationAction.Remove:
      return PostModerationState.Removed;
    case PostModerationAction.Restore:
      return PostModerationState.Ok;
  }
}

export interface ActionPostInput {
  postId: string;
  action: PostModerationAction;
  reason: string;
}

/**
 * Apply a moderator action to a post. Returns the updated `Post` shape so
 * the API can echo it back — matches the contract of the edit/create
 * endpoints that return the post after mutation.
 *
 *   404 — no such post. Same mask the viewer side uses; admins don't need
 *         to disambiguate "deleted" from "never existed" at this layer.
 */
export async function actionPost(
  db: Database,
  actor: ModeratorActor,
  input: ActionPostInput,
): Promise<Post> {
  const targetState = postStateForAction(input.action);
  // For 'restore' the reason is still recorded on the row — the spec
  // requires it, and keeping the row's last `moderation_reason` tells a
  // viewer of the audit log *why* the post is currently OK (it got restored
  // because of X) without a cross-reference to the audit entries.

  const updatedRow = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(post)
      .where(eq(post.id, input.postId))
      .limit(1);
    if (!existing) {
      throw new PorchError(ErrorCode.NotFound, 'Post not found.');
    }

    const [updated] = await tx
      .update(post)
      .set({
        moderationState: targetState,
        moderationReason: input.reason,
        moderatedAt: new Date(),
      })
      .where(eq(post.id, input.postId))
      .returning();
    if (!updated) {
      // Should not happen — the select succeeded so the row existed at the
      // start of the tx and cascade-delete doesn't apply here. If it does
      // we want a loud failure, not a silent empty return.
      throw new PorchError(
        ErrorCode.InternalError,
        'Post disappeared during moderation action.',
      );
    }

    await tx.insert(auditLog).values({
      accountId: actor.accountId,
      personaId: actor.personaId ?? null,
      action: 'moderation.post_actioned',
      entityType: 'post',
      entityId: input.postId,
      metadata: {
        action: input.action,
        reason: input.reason,
        previousState: existing.moderationState,
        newState: targetState,
      } as never,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
    });

    return updated;
  });

  // Load the author persona outside the tx — the mutation is already durable
  // and we only need the author to build the API response shape. If the
  // persona is somehow gone (shouldn't be — FK is cascade) we 404 rather
  // than 500 so the caller retries against a fresh state.
  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, updatedRow.authorPersonaId))
    .limit(1);
  if (!authorRow) {
    throw new PorchError(
      ErrorCode.NotFound,
      'Author persona not found for moderated post.',
    );
  }

  return toApiPost(updatedRow, toPublicPersona(authorRow));
}

// ── Persona ──────────────────────────────────────────────────────────────

function personaStateForAction(
  action: PersonaModerationAction,
): PersonaModerationState {
  switch (action) {
    case PersonaModerationAction.Restrict:
      return PersonaModerationState.Restricted;
    case PersonaModerationAction.Suspend:
      return PersonaModerationState.Suspended;
    case PersonaModerationAction.Restore:
      return PersonaModerationState.Ok;
  }
}

export interface ActionPersonaInput {
  personaId: string;
  action: PersonaModerationAction;
  reason: string;
  /**
   * Advisory only in v0 — no scheduled job reinstates expired suspensions.
   * Stored on the audit row's metadata for future-compat and transparency.
   */
  durationDays?: number;
}

/**
 * Apply a moderator action to a persona. Returns the full `Persona` domain
 * shape (including the new moderationState) so admin clients have the
 * authoritative after-state without a follow-up read.
 */
export async function actionPersona(
  db: Database,
  actor: ModeratorActor,
  input: ActionPersonaInput,
): Promise<Persona> {
  const targetState = personaStateForAction(input.action);

  const updatedRow = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(persona)
      .where(eq(persona.id, input.personaId))
      .limit(1);
    if (!existing) {
      throw new PorchError(ErrorCode.NotFound, 'Persona not found.');
    }

    const [updated] = await tx
      .update(persona)
      .set({
        moderationState: targetState,
        moderationReason: input.reason,
      })
      .where(eq(persona.id, input.personaId))
      .returning();
    if (!updated) {
      throw new PorchError(
        ErrorCode.InternalError,
        'Persona disappeared during moderation action.',
      );
    }

    await tx.insert(auditLog).values({
      accountId: actor.accountId,
      personaId: actor.personaId ?? null,
      action: 'moderation.persona_actioned',
      entityType: 'persona',
      entityId: input.personaId,
      metadata: {
        action: input.action,
        reason: input.reason,
        previousState: existing.moderationState,
        newState: targetState,
        // Only include durationDays when it applies to this action — keeps
        // the metadata readable when it's meaningless (restrict/restore).
        ...(input.durationDays !== undefined &&
        input.action === PersonaModerationAction.Suspend
          ? { durationDays: input.durationDays }
          : {}),
      } as never,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
    });

    return updated;
  });

  return toApiPersona(updatedRow);
}

// ── Helpers ──────────────────────────────────────────────────────────────

type PersonaRow = typeof persona.$inferSelect;

/**
 * Full persona projection — includes moderationState, unlike the narrower
 * `PublicPersona` helper in `contact/helpers.ts`. Lives here because the
 * moderation response is the only surface today that needs the full row's
 * admin-visible fields echoed back.
 */
function toApiPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    username: row.username,
    did: row.did,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    moderationState: row.moderationState as PersonaModerationState,
  };
}

export { toApiPersona };
