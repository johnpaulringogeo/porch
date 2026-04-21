'use client';

/**
 * Home feed page. Thin wrapper over <HomeFeed> — the route exists mainly
 * to give the feed its own URL and header chrome; the component does all
 * the data work.
 */

import { useAuth } from '@/lib/auth-context';
import { HomeFeed } from '@/components/home-feed';

export default function FeedPage() {
  const { session } = useAuth();
  if (!session) return null; // layout already gated

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mode-home-surface px-2.5 py-1 text-xs font-medium text-mode-home ring-1 ring-mode-home/30">
            <span className="h-1.5 w-1.5 rounded-full bg-mode-home" />
            Home feed
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Your feed</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Posts from people you&apos;re mutual contacts with. Newest first.
        </p>
      </section>

      <HomeFeed />
    </div>
  );
}
