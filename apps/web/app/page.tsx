/**
 * v0 landing page. Intro copy on the platform, links into auth, and the
 * five-mode preview. The marketing/landing experience will be replaced in
 * a later milestone — for now it doubles as the "hello stranger" page.
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-[hsl(var(--text-muted))]">
        Porch · v0
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">
        A persona-native social platform.
      </h1>
      <p className="text-lg leading-relaxed text-[hsl(var(--text-muted))]">
        Five modes — Home, Public, Community, Professional, Creators — each with
        its own contract, audience, and visual language. One identity per
        person, distinct personas per mode, portable via{' '}
        <code className="rounded bg-[hsl(var(--surface-muted))] px-1.5 py-0.5 text-sm">
          did:web
        </code>
        .
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a
          href="/signup"
          className="rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Create an account
        </a>
        <a
          href="/login"
          className="rounded-md border border-[hsl(var(--border-default))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--surface-muted))]"
        >
          Log in
        </a>
      </div>

      <div className="flex flex-wrap gap-3 pt-6 text-sm">
        <span className="rounded-full bg-mode-home px-3 py-1 text-white">
          Home
        </span>
        <span className="rounded-full bg-mode-public px-3 py-1 text-white">
          Public
        </span>
        <span className="rounded-full bg-mode-community px-3 py-1 text-white">
          Community
        </span>
        <span className="rounded-full bg-mode-professional px-3 py-1 text-white">
          Professional
        </span>
        <span className="rounded-full bg-mode-creators px-3 py-1 text-white">
          Creators
        </span>
      </div>
    </main>
  );
}
