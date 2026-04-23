import { eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { account } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { AccountStatus } from '@porch/types/domain';
import type { AccountMe } from '@porch/types/api';
import { toAccountMe } from './me.js';

/**
 * Cancel a pending account deletion. Flips `status` back to `active` and
 * clears `deletionRequestedAt`. Intentionally idempotent on the happy path
 * only — calling cancel on an account that isn't in `deletion_requested` is
 * a client bug (they shouldn't have shown the cancel affordance), so we
 * 409 rather than silently no-op.
 *
 * We do *not* restore sessions revoked by `requestDeletion`. The user is
 * cancelling from the session they logged back in on; the other devices
 * stay signed out. Storing the pre-revocation session set and reviving it
 * here would complicate the delete path (sessions table would need an
 * `suspendedAt` distinct from `revokedAt`) for a marginal convenience win
 * — the user can just log back in on their other devices.
 *
 * Note on status transitions: we always go back to `active`, never to
 * `restricted`. v0 has no automated restriction flow, so the only way a
 * user could land in `restricted` pre-request is via moderator action —
 * and those moderator actions are orthogonal to deletion state. If we add
 * automated restriction later, this function will need to remember the
 * pre-request status and restore it.
 *
 * Rejections:
 *   409 — account is already `active`/`restricted` (nothing to cancel).
 *   403 — account is `suspended` or `deleted`. Suspended accounts don't
 *         self-serve anything; deleted is a terminal state.
 */
export async function cancelDeletion(
  db: Database,
  accountId: string,
): Promise<AccountMe> {
  const [row] = await db
    .select()
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1);

  if (!row) {
    throw new PorchError(ErrorCode.NotFound, 'Account not found.');
  }

  if (row.status === AccountStatus.Deleted) {
    throw new PorchError(
      ErrorCode.Forbidden,
      'This account has already been deleted.',
    );
  }

  if (row.status === AccountStatus.Suspended) {
    throw new PorchError(
      ErrorCode.Forbidden,
      'Suspended accounts cannot cancel deletion; contact support.',
    );
  }

  if (row.status !== AccountStatus.DeletionRequested) {
    throw new PorchError(
      ErrorCode.Conflict,
      'Account is not pending deletion.',
    );
  }

  const [updated] = await db
    .update(account)
    .set({
      status: AccountStatus.Active,
      deletionRequestedAt: null,
    })
    .where(eq(account.id, accountId))
    .returning();

  if (!updated) {
    throw new PorchError(ErrorCode.NotFound, 'Account not found.');
  }

  return toAccountMe(updated);
}
