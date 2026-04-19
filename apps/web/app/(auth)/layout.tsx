/**
 * Layout for the unauthenticated auth pages (signup, login). Mirrors the
 * marketing landing — centered column, plenty of breathing room. The
 * AuthProvider itself lives in the root layout so state persists across
 * both (auth) and (app) route groups.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[hsl(var(--surface-default))]">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
        <a
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-default))]"
        >
          ← Porch
        </a>
        {children}
      </main>
    </div>
  );
}
