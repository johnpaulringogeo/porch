'use client';

import { useAuth } from '@/lib/auth-context';

/**
 * Placeholder "you are logged in" page. The real mode dashboards land in
 * later milestones; for now we just confirm the session is live and give
 * Matt something to stare at that proves the full stack works.
 */
export default function DashboardPage() {
  const { session } = useAuth();
  if (!session) return null; // the layout already handled this

  const { account, persona } = session;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--text-muted))]">
          You&apos;re in
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome, {persona.displayName}.
        </h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          The five-mode experience is under construction. This page will
          become your Home mode in a future milestone — for now it just
          proves auth works end-to-end.
        </p>
      </section>

      <section className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--text-muted))]">
          Session snapshot
        </h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-[200px_1fr]">
          <dt className="text-[hsl(var(--text-muted))]">Account ID</dt>
          <dd className="font-mono text-xs">{account.id}</dd>

          <dt className="text-[hsl(var(--text-muted))]">Email</dt>
          <dd>
            {account.email}
            {account.emailVerified ? (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                verified
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                unverified
              </span>
            )}
          </dd>

          <dt className="text-[hsl(var(--text-muted))]">Handle</dt>
          <dd>@{persona.username}</dd>

          <dt className="text-[hsl(var(--text-muted))]">DID</dt>
          <dd className="font-mono text-xs break-all">{persona.did}</dd>

          <dt className="text-[hsl(var(--text-muted))]">Persona ID</dt>
          <dd className="font-mono text-xs">{persona.id}</dd>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Modes</h2>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Each mode will have its own dashboard. None are built yet.
        </p>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          {(['home', 'public', 'community', 'professional', 'creators'] as const).map(
            (mode) => (
              <span
                key={mode}
                className={`rounded-full px-3 py-1 text-white opacity-70 bg-mode-${mode}`}
              >
                {mode[0]?.toUpperCase() + mode.slice(1)}
              </span>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
