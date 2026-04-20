'use client';

import { useAuth } from '@/lib/auth-context';

/**
 * Mode metadata with *literal* class strings so Tailwind JIT picks them up.
 * Dynamic `bg-mode-${key}` interpolation would require a safelist.
 */
const MODES = [
  { key: 'home',         label: 'Home',         dot: 'bg-mode-home',         surface: 'bg-mode-home-surface',         border: 'border-mode-home/40' },
  { key: 'public',       label: 'Public',       dot: 'bg-mode-public',       surface: 'bg-mode-public-surface',       border: 'border-mode-public/40' },
  { key: 'community',    label: 'Community',    dot: 'bg-mode-community',    surface: 'bg-mode-community-surface',    border: 'border-mode-community/40' },
  { key: 'professional', label: 'Professional', dot: 'bg-mode-professional', surface: 'bg-mode-professional-surface', border: 'border-mode-professional/40' },
  { key: 'creators',     label: 'Creators',     dot: 'bg-mode-creators',     surface: 'bg-mode-creators-surface',     border: 'border-mode-creators/40' },
] as const;

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
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mode-home-surface px-2.5 py-1 text-xs font-medium text-mode-home ring-1 ring-mode-home/30">
            <span className="h-1.5 w-1.5 rounded-full bg-mode-home" />
            Home mode
          </span>
          <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--text-muted))]">
            You&apos;re in
          </p>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome, {persona.displayName}.
        </h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          The five-mode experience is under construction. Home is the only
          mode live in v0 — for now this page just proves auth works
          end-to-end.
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Modes</h2>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          One account, many personas, five modes. Only Home is live in v0.
        </p>
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-5">
          {MODES.map((m) => (
            <div
              key={m.key}
              className={
                m.key === 'home'
                  ? `${m.surface} ${m.border} rounded-lg border p-4`
                  : 'rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-4 opacity-60'
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{m.label}</span>
                <span className={`h-2 w-2 rounded-full ${m.dot}`} />
              </div>
              <p className="mt-2 text-xs text-[hsl(var(--text-muted))]">
                {m.key === 'home' ? 'Active — you\u2019re here now.' : 'Later milestone.'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
