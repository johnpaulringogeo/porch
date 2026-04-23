import { eq } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { account } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { AccountMe } from '@porch/types/api';
import { GRACE_PERIOD_MS } from './grace.js';

/**
 * Fetch the signed-in account row and shape it into the API `AccountMe`
 * contract. Kept in its own file so the deletion request/cancel paths can
 * reuse the same projection after they mutate — avoiding drift between the
 * "status flipped" return value and a subsequent GET /me.
 *
 * Throws 404 if the account has been hard-deleted out from under the caller
 * (shouldn't happen pre-grace-period, but the route-layer auth check only
 * validates the JWT — it doesn't prove the account row still exists).
 */
export async function getAccountMe(
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

  return toAccountMe(row);
}

/**
 * Project an `account` table row into the `AccountMe` API shape. The grace
 * end is computed client-agnostically here (requestedAt + 30 days) so every
 * caller agrees on when deletion finalises — we don't want the UI to do
 * date math off a raw timestamp and drift from the server's cutoff.
 */
export function toAccountMe(row: typeof account.$inferSelect): AccountMe {
  const deletionRequestedAt = row.deletionRequestedAt;
  const graceEndsAt = deletionRequestedAt
    ? new Date(deletionRequestedAt.getTime() + GRACE_PERIOD_MS)
    : null;

  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    deletionRequestedAt: deletionRequestedAt?.toISOString() ?? null,
    deletionGraceEndsAt: graceEndsAt?.toISOString() ?? null,
  };
}
