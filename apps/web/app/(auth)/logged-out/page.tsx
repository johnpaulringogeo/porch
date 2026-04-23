'use client';

/**
 * Signed-out confirmation page — `/logged-out`.
 *
 * Where authenticated flows land the user after they've intentionally left
 * their session (plain sign-out, account deletion request, explicit
 * revocation). Rendered inside the `(auth)` layout so it shares the same
 * centered, un-chromed look as login/signup.
 *
 * We branch on `?reason=` to swap in the explanation copy. Anything we don't
 * recognise falls back to a neutral "You're signed out" message — old links
 * and new reasons both degrade gracefully.
 *
 *   reason=deletion   → account-deletion grace explainer
 *   reason=revoked    → session was revoked from another device (v0.5)
 *   (anything else)   → generic signed-out state
 *
 * If the user is somehow still signed in when they hit this page (e.g. they
 * navigated here manually), we bounce them back to `/dashboard`. The grace
 * period ultimately enforces auth on the server — this is just a guard to
 * keep the UI honest.
 */

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function LoggedOutPage() {
  // useSearchParams() forces this into a Suspense boundary during static
  // generation; wrap it so `next build` doesn't bail on the route.
  return (
    <Suspense fallback={<LoggedOutFrame title="You're signed out" body={null} />}>
      <LoggedOutInner />
    </Suspense>
  );
}

function LoggedOutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useAuth();

  const reason = params.get('reason');

  useEffect(() => {
    // If we still have a session (e.g. someone landed here manually), don't
    // lie to them — send them home.
    if (session) router.replace('/dashboard');
  }, [session, router]);

  if (reason === 'deletion') {
    return (
      <LoggedOutFrame
        title="Account deletion requested"
        body={
          <>
            <p>
              We&apos;ve started a 30-day grace period on your account. All
              sessions have been signed out, including this one.
            </p>
            <p>
              Changed your mind? Log back in any time in the next 30 days and
              go to{' '}
              <span className="font-medium text-[hsl(var(--text-default))]">
                Settings → Account
              </span>{' '}
              to cancel. After 30 days, your posts, personas, and contacts are
              permanently removed.
            </p>
          </>
        }
      />
    );
  }

  if (reason === 'revoked') {
    return (
      <LoggedOutFrame
        title="You've been signed out"
        body={
          <p>
            This session was revoked from another device. Log back in to
            continue.
          </p>
        }
      />
    );
  }

  return (
    <LoggedOutFrame
      title="You're signed out"
      body={<p>Log back in any time to pick up where you left off.</p>}
    />
  );
}

function LoggedOutFrame({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}) {
  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </header>

      {body ? (
        <div className="space-y-3 text-sm text-[hsl(var(--text-muted))]">
          {body}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Log back in
        </Link>
        <Link
          href="/"
          className="text-center text-sm text-[hsl(var(--text-muted))] underline underline-offset-2 hover:text-[hsl(var(--text-default))]"
        >
          Back to home
        </Link>
      </div>
    </>
  );
}
