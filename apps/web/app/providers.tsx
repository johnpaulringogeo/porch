'use client';

/**
 * Root-level client providers. Next's App Router wants a single client
 * boundary at the top so server components below can stay server — everything
 * that depends on auth state renders as a child of this tree.
 */

import { AuthProvider } from '@/lib/auth-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
