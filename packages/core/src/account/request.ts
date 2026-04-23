import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { account, session } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { AccountStatus } from '@porch/types/domain';
import type { AccountMe } from '@porch/types/api';
import { toAccountMe } from './me.js';

/**
 * Request account deletion. Flips `status` from `active`/`restricted` to
 * `deletion_requested`, stamps `deletionRequestedAt`, and revokes every
 * open session on the account so the user is signed out of all devices.
 *
 * The 30-day grace window is enforced at the `deletionGraceEndsAt` cutoff
 * returned from `getAccountMe`/`toAccountMe`; this function only flips the
 * initiating state. A scheduled job (out of scope for v0 per spec §18.5)
 * performs the hard delete after grace expires.
 *
 * Rejections:
 *   409 — already in `deletion_requested`. The client likely double-posted
 *         or missed our 200; we don't restart the 30-day clock from here
 *         because that would let a user extend their own grace indefinitely
 *         by re-requesting. To extend, cancel and re-request.
 *   403 — `suspended` or already `deleted`. Moderation-suspended accounts
 *         go through a separate admin flow, and a deleted account has no
 *         self-serve surface area.
 *
 * This runs in a transaction: the status flip and the session revocation
 * must either both succeed or both fail. If we revoked sessions but the
 * status update rolled back, the user would be silently logged out without
 * a deletion record — a confusing and non-recoverable state.
 */
export async function requestDeletion(
  db: Database,
  accountId: string,
): Promise<AccountMe> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1);

    if (!row) {
      // Same shape as "not found" elsewhere — the JWT survived but the row
      // doesn't. Shouldn't happen in v0 (no hard-delete path yet) but we
      // prefer a coherent 404 to a transaction that fails with a cryptic
      // NOT-NULL violation on returning().
      throw new PorchError(ErrorCode.NotFound, 'Account not found.');
    }

    if (row.status === AccountStatus.DeletionRequested) {
      throw new PorchError(
        ErrorCode.Conflict,
        'Account deletion has already been requested. Cancel first to restart the grace period.',
      );
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
        'Suspended accounts cannot self-delete; contact support.',
      );
    }

    const now = new Date();

    const [updated] = await tx
      .update(account)
      .set({
        status: AccountStatus.DeletionRequested,
        deletionRequestedAt: now,
      })
      .where(eq(account.id, accountId))
      .returning();

    if (!updated) {
      // Row existed at the select but not at the update — would only fire
      // under a concurrent hard delete, which doesn't exist in v0. Treat
      // as 404 so the client clears its cached session.
      throw new PorchError(ErrorCode.NotFound, 'Account not found.');
    }

    // Revoke every non-revoked session for this account. Pre-revocation
    // access tokens remain valid until their 15-minute expiry (the
    // requireAuth middleware also short-circuits `deletion_requested`
    // accounts so they can't keep acting) but no new refresh can succeed.
    await tx
      .update(session)
      .set({ revokedAt: now })
      .where(and(eq(session.accountId, accountId), isNull(session.revokedAt)));

    return toAccountMe(updated);
  });
}
