import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { PersonaModerationState } from '@porch/types/domain';
import type { MyPersona } from '@porch/types/api';

/**
 * Account-scoped persona operations: listing the personas a signed-in
 * account owns, and validating switch targets.
 *
 * The visibility rules are deliberately narrow for v0:
 *   - Archived personas are hidden everywhere (signup creates the default
 *     and v0 has no archive UI yet, but the filter is here so it works
 *     once archive lands).
 *   - Suspended personas are filtered from listings *and* blocked as a
 *     switch target — we don't want a moderation action to leave the user
 *     trapped on a persona that surfaces as 404 in every public route.
 *
 * Key material is never exposed: list returns the public-shaped MyPersona,
 * and `resolveSwitchTarget` returns the raw row only so the route can
 * mint a new access token with its did/username. Neither function mutates
 * the session row — that's the route layer's job via Auth.setActivePersona,
 * which keeps session concerns out of the persona module.
 */

/**
 * List every visible persona belonging to `accountId`, ordered with the
 * default persona first then by createdAt asc. The `activePersonaId` is
 * used to set the per-row `isActive` flag so the switcher can render a
 * check next to the current one without a follow-up query.
 *
 * Suspended and archived personas are excluded — see the file-level note
 * for why. If we ever surface archived personas (a "deleted but
 * recoverable" UI), add an `includeArchived` option here rather than
 * loosening the default filter.
 */
export async function listMyPersonas(
  db: Database,
  accountId: string,
  activePersonaId: string,
): Promise<MyPersona[]> {
  const rows = await db
    .select()
    .from(persona)
    .where(
      and(
        eq(persona.accountId, accountId),
        isNull(persona.archivedAt),
      ),
    )
    .orderBy(desc(persona.isDefault), asc(persona.createdAt));

  return rows
    .filter((row) => row.moderationState !== PersonaModerationState.Suspended)
    .map((row) => ({
      id: row.id,
      username: row.username,
      did: row.did,
      displayName: row.displayName,
      bio: row.bio,
      avatarUrl: row.avatarUrl,
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString(),
      isActive: row.id === activePersonaId,
    }));
}

/**
 * Validate that `targetPersonaId` belongs to `accountId`, is not archived,
 * and is not suspended — and return the row so the caller can reuse its
 * did/username when minting a new access token.
 *
 * This does *not* mutate session.active_persona_id. The route layer calls
 * Auth.setActivePersona after this resolves; keeping the session write out
 * of the persona module avoids a circular dependency and mirrors the way
 * auth.ts signup/login already compose persona creation with session
 * creation at the edge.
 *
 * Error mapping:
 *   - 404 if the persona doesn't exist *or* belongs to another account.
 *     Same shape for both so we don't confirm the existence of someone
 *     else's persona ID.
 *   - 409 if the persona is archived (hidden but present): the user
 *     picked a stale ID, which is a client bug rather than a permission
 *     issue.
 *   - 403 if the persona is suspended (moderation action).
 */
export async function resolveSwitchTarget(
  db: Database,
  accountId: string,
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
      'That persona has been archived and can no longer be activated.',
    );
  }

  if (row.moderationState === PersonaModerationState.Suspended) {
    throw new PorchError(
      ErrorCode.Forbidden,
      'That persona is suspended and cannot be activated.',
    );
  }

  return row;
}
