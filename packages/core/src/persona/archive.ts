import { eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { PersonaModerationState } from '@porch/types/domain';

/**
 * Soft-delete a persona: stamps `archivedAt` with the current time and
 * returns the updated row. Archived personas disappear from listMyPersonas,
 * cannot be switched to (resolveSwitchTarget rejects with 409), and 404
 * from /personas/:username/profile — the existing visibility rules do the
 * hiding for us; this function's only job is to flip the bit safely.
 *
 * Rejections (each throws a PorchError the error middleware maps to JSON):
 *
 *   404 — persona doesn't exist or belongs to another account. Same shape
 *         for both so we don't confirm the existence of someone else's
 *         persona id.
 *   409 — persona is the account's default. v0 requires every account to
 *         keep a default; there's no "set a new default" endpoint yet, so
 *         we block the destructive action rather than leaving the account
 *         defaultless.
 *   409 — persona is the one the current session is acting as. Archiving
 *         the active persona would leave the session pointing at a hidden
 *         row; we'd rather the user explicitly switch first so the UX is
 *         coherent ("you archived Alice; you're now acting as Bob" is a
 *         surprising side effect to bake into a delete).
 *   409 — persona is already archived. Idempotent-ish alternatives (200
 *         on already-archived) feel fine in isolation but combined with
 *         the other 409 paths they blur the meaning of the response code.
 *   403 — persona is suspended. Mirrors resolveSwitchTarget's rule so
 *         moderation-blocked personas behave the same across mutation
 *         endpoints. listMyPersonas already hides suspended personas, so
 *         under normal UI flow the client can't even reach this path —
 *         the defensive check is for a client that caches the id.
 *
 * Note on sessions: this function does *not* revoke session rows pointing
 * at the archived persona. The only way for that to happen in practice is
 * if the archive operation somehow raced a session creation — which it
 * can't, because archiving the active persona is rejected above. In the
 * pathological case where a session did exist, its next /refresh would
 * find an archived persona and fail, and the user would be re-prompted to
 * log in. Good enough for v0; a follow-up can force-rotate at archive
 * time if we want cleaner semantics.
 */
export async function archivePersona(
  db: Database,
  accountId: string,
  activePersonaId: string,
  targetPersonaId: string,
): Promise<typeof persona.$inferSelect> {
  const [row] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, targetPersonaId))
    .limit(1);

  if (!row || row.accountId !== accountId) {
    throw new PorchError(ErrorCode.NotFound, 'No such persona.');
  }

  if (row.archivedAt) {
    throw new PorchError(
      ErrorCode.Conflict,
      'That persona is already archived.',
    );
  }

  if (row.isDefault) {
    throw new PorchError(
      ErrorCode.Conflict,
      "Your default persona can't be archived.",
    );
  }

  if (row.id === activePersonaId) {
    throw new PorchError(
      ErrorCode.Conflict,
      'Switch to a different persona before archiving this one.',
    );
  }

  if (row.moderationState === PersonaModerationState.Suspended) {
    throw new PorchError(
      ErrorCode.Forbidden,
      'That persona is suspended and cannot be archived.',
    );
  }

  const [updated] = await db
    .update(persona)
    .set({ archivedAt: new Date() })
    .where(eq(persona.id, targetPersonaId))
    .returning();

  if (!updated) {
    // Row existed a moment ago and we hold its id — this would only fire
    // if the row was deleted under us (not possible in v0, no hard-delete
    // path), so treat as a 404 so the client clears its stale list.
    throw new PorchError(ErrorCode.NotFound, 'No such persona.');
  }

  return updated;
}
