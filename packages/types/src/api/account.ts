import type { Account, AccountStatus } from '../domain/index.js';

/**
 * Account-level API shapes backing `/api/account/*`.
 *
 * The account endpoints differ from persona ones in subject: they act on the
 * authenticated *account* (the login identity), not on the active persona.
 * Account deletion in particular is irreversible after the grace period and
 * wipes every persona, session, and DID document tied to the account — so we
 * keep these shapes in their own file instead of bundling them with auth.
 */

/**
 * GET /api/account/me
 *
 * The signed-in view of the caller's own account. Mirrors the `Account`
 * domain type but adds deletion-grace fields so the settings UI can render
 * "X days remaining" inline without a second fetch.
 *
 * `deletionRequestedAt` and `deletionGraceEndsAt` are both null when the
 * account is `active` (or `restricted`). Once the user requests deletion,
 * both populate and `status` flips to `deletion_requested`. Cancelling the
 * request clears them and flips status back to `active`.
 *
 * The grace end is computed server-side (requestedAt + 30 days) and included
 * here so the client can't drift from the server's clock; we never want the
 * UI and the enforcement logic to disagree about when deletion finalises.
 */
export interface AccountMe extends Pick<Account, 'id' | 'email' | 'emailVerified' | 'status' | 'createdAt'> {
  deletionRequestedAt: string | null;
  deletionGraceEndsAt: string | null;
}

export interface GetAccountMeResponse {
  account: AccountMe;
}

/**
 * POST /api/account/request-deletion
 *
 * Initiates the 30-day grace window. Every existing session for this account
 * is revoked — the user is signed out of all devices — so the client should
 * clear its in-memory access token on 200 and redirect to a confirmation
 * screen (the refresh cookie is also cleared by the route). The returned
 * shape mirrors `AccountMe` so the (now-signed-out) UI can still render the
 * "X days remaining" state on the confirmation page without re-fetching.
 */
export interface RequestAccountDeletionResponse {
  account: AccountMe;
}

/**
 * POST /api/account/cancel-deletion
 *
 * Cancels a pending deletion. Status returns to `active` and both deletion
 * timestamps clear. Sessions are *not* restored — the user remains logged
 * in on whichever device initiated the cancel (the rest stay signed out
 * from the original request). That's a deliberate tradeoff: re-granting the
 * other sessions would require storing them pre-revocation, which
 * complicates the delete path for a marginal convenience win.
 */
export interface CancelAccountDeletionResponse {
  account: AccountMe;
}

/**
 * Re-export the domain enum so callers that import only from `@porch/types/api`
 * don't need a second import for the literal union.
 */
export type { AccountStatus };
