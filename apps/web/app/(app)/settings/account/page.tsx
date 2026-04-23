'use client';

/**
 * Account settings — `/settings/account`.
 *
 * Home for account-level actions (login email, password, deletion). v0 only
 * ships the deletion flow; email/password editing are stubs on the API side
 * for now, so this page focuses on two states of the delete affordance:
 *
 *   Active → "Delete account" button → confirm dialog → POST /delete
 *     On 200: the server revokes every session on this account, so the
 *     refresh cookie is dead. We clear the in-memory session via
 *     auth-context and send the user to `/logged-out?reason=deletion` so
 *     they land on a signed-out confirmation page that explains the grace
 *     period and how to cancel.
 *
 *   DeletionRequested → banner with days remaining + "Cancel deletion"
 *     On 200: status flips back to active; we refetch /me so the banner
 *     goes away without a full reload. Sessions on other devices stay
 *     revoked by design (see apps/api notes in AccountOps.cancelDeletion).
 *
 * We intentionally don't show the "Delete account" button to suspended or
 * deleted accounts — both are terminal states a normal user can't reach in
 * v0 (suspended is moderation-only, deleted is post-grace-period).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AccountMe,
  CancelAccountDeletionResponse,
  GetAccountMeResponse,
  RequestAccountDeletionResponse,
} from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function AccountSettingsPage() {
  const router = useRouter();
  const { session, accessToken, logout } = useAuth();

  const [account, setAccount] = useState<AccountMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!accessToken) return;
      setLoading(true);
      setLoadError(null);
      try {
        const res = await api<GetAccountMeResponse>({
          path: '/api/account/me',
          accessToken,
          signal,
        });
        setAccount(res.account);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Could not load your account. Please reload the page.',
        );
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (!accessToken) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [accessToken, load]);

  async function handleRequestDeletion() {
    if (!accessToken) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api<RequestAccountDeletionResponse>({
        method: 'POST',
        path: '/api/account/delete',
        accessToken,
      });
      // The server just revoked every session on this account — our refresh
      // cookie is dead. Clear the in-memory session (best-effort /logout
      // call will 401 but auth-context still wipes the state) and land on
      // the signed-out confirmation page.
      await logout();
      router.replace('/logged-out?reason=deletion');
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : 'Could not start deletion. Please try again.',
      );
      setSubmitting(false);
    }
  }

  async function handleCancelDeletion() {
    if (!accessToken) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await api<CancelAccountDeletionResponse>({
        method: 'POST',
        path: '/api/account/delete/cancel',
        accessToken,
      });
      setAccount(res.account);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : 'Could not cancel deletion. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Manage account-level settings. Persona-specific settings live in{' '}
          <Link
            href="/settings/profile"
            className="font-medium underline underline-offset-2"
          >
            Edit profile
          </Link>
          .
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[hsl(var(--text-muted))]">Loading…</p>
      ) : account ? (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Login</h2>
            <dl className="space-y-1 rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[hsl(var(--text-muted))]">Email</dt>
                <dd>{account.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[hsl(var(--text-muted))]">Verified</dt>
                <dd>{account.emailVerified ? 'Yes' : 'Not yet'}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Activity</h2>
            <div className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-4 py-3 text-sm">
              <p className="text-[hsl(var(--text-muted))]">
                Review sign-ins, persona switches, and other actions on your
                account.
              </p>
              <Link
                href="/settings/account/activity"
                className="mt-2 inline-flex items-center text-sm font-medium underline underline-offset-2"
              >
                View activity log →
              </Link>
            </div>
          </section>

          {account.status === 'deletion_requested' ? (
            <PendingDeletionBanner
              account={account}
              submitting={submitting}
              error={actionError}
              onCancel={handleCancelDeletion}
            />
          ) : account.status === 'active' || account.status === 'restricted' ? (
            <DeleteSection
              confirming={confirming}
              submitting={submitting}
              error={actionError}
              onOpen={() => {
                setConfirming(true);
                setActionError(null);
              }}
              onCancel={() => setConfirming(false)}
              onConfirm={handleRequestDeletion}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PendingDeletionBanner({
  account,
  submitting,
  error,
  onCancel,
}: {
  account: AccountMe;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  // Compute "X days remaining" from the server-provided cutoff. We floor so
  // "0 days remaining" only shows on the literal last day; everything else
  // rounds down to "N days". Server clock is authoritative — we don't
  // recompute the cutoff locally.
  const graceEndsAt = account.deletionGraceEndsAt
    ? new Date(account.deletionGraceEndsAt)
    : null;
  const msRemaining = graceEndsAt
    ? Math.max(0, graceEndsAt.getTime() - Date.now())
    : 0;
  const daysRemaining = Math.floor(msRemaining / (24 * 60 * 60 * 1000));

  return (
    <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-amber-900">
          Deletion pending — {daysRemaining} day{daysRemaining === 1 ? '' : 's'}{' '}
          remaining
        </h2>
        <p className="text-sm text-amber-900">
          Your account will be permanently deleted on{' '}
          {graceEndsAt
            ? graceEndsAt.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : 'the scheduled date'}
          . All your posts, personas, and contacts will be removed. Cancel any
          time before then to keep your account.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Cancelling…' : 'Cancel deletion'}
      </button>
    </section>
  );
}

function DeleteSection({
  confirming,
  submitting,
  error,
  onOpen,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  submitting: boolean;
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Delete account</h2>
      <div className="space-y-3 rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-4 py-3 text-sm">
        <p className="text-[hsl(var(--text-muted))]">
          Deletion starts a 30-day grace period. You&apos;ll be signed out on
          every device and will need to log back in to cancel before the
          grace ends. After 30 days, all your posts, personas, and contacts
          are permanently removed.
        </p>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        ) : null}

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Requesting…' : 'Yes, delete my account'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-1.5 text-sm hover:bg-[hsl(var(--surface-muted))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Keep my account
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete account…
          </button>
        )}
      </div>
    </section>
  );
}
