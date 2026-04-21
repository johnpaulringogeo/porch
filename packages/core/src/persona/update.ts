import { eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { PersonaModerationState } from '@porch/types/domain';

/**
 * Apply an in-place patch to a persona's profile fields. Used by
 * PATCH /api/personas/:personaId so a signed-in user can fix typos in
 * their displayName or update their bio.
 *
 * Scope (v0):
 *   - displayName  string, 1..64 chars (already validated by zod at the edge)
 *   - bio          string up to 280 chars, or `null` to clear
 *
 * username/did are intentionally not editable: they're baked into the
 * persona's did:web identifier and would invalidate every signature on
 * existing posts. avatarUrl isn't editable here either — there's no upload
 * pipeline yet, and we don't want to expose the raw URL field as a write
 * surface (someone would just paste a tracking pixel).
 *
 * Authorization is by ownership: a 404 is returned for both "no such
 * persona" and "owned by another account" so we don't confirm the
 * existence of someone else's persona ID. Archived (409) and suspended
 * (403) targets are rejected — symmetrical with resolveSwitchTarget so
 * the lifecycle states behave consistently across mutation routes.
 *
 * Returns the updated row. Empty patches (no fields supplied) still
 * succeed and just return the current row — keeps the route layer
 * simple and lets the client treat a save with no diffs as a no-op.
 */
export async function updatePersona(
  db: Database,
  accountId: string,
  personaId: string,
  patch: { displayName?: string; bio?: string | null },
): Promise<typeof persona.$inferSelect> {
  // Load + authorize first so a no-op patch on someone else's persona
  // still returns 404 rather than silently succeeding.
  const [row] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, personaId))
    .limit(1);

  if (!row || row.accountId !== accountId) {
    throw new PorchError(ErrorCode.NotFound, 'No such persona.');
  }

  if (row.archivedAt) {
    throw new PorchError(
      ErrorCode.Conflict,
      'That persona has been archived and can no longer be edited.',
    );
  }

  if (row.moderationState === PersonaModerationState.Suspended) {
    throw new PorchError(
      ErrorCode.Forbidden,
      'That persona is suspended and cannot be edited.',
    );
  }

  // Build a minimal update object so unspecified fields stay untouched.
  // Drizzle's update().set({}) is a syntax error, so short-circuit when
  // there's nothing to apply.
  const updates: Partial<typeof persona.$inferInsert> = {};
  if (patch.displayName !== undefined) updates.displayName = patch.displayName;
  if (patch.bio !== undefined) updates.bio = patch.bio;

  if (Object.keys(updates).length === 0) {
    return row;
  }

  const [updated] = await db
    .update(persona)
    .set(updates)
    .where(eq(persona.id, personaId))
    .returning();

  if (!updated) {
    // The row was visible a moment ago and we hold its id — the only way
    // this fails is a race with archive/delete. Surface as 404 so the
    // client clears whatever stale state it was rendering.
    throw new PorchError(ErrorCode.NotFound, 'No such persona.');
  }

  return updated;
}
