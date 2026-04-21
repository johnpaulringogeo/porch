'use client';

/**
 * `<UsernameLink username="alice">` → `<Link href="/u/alice">@alice</Link>`.
 *
 * One tiny component so every post header, contact row, request row, and
 * notification body links through the same way — and so the URL shape lives
 * in exactly one place. If we ever add an avatar inline, this is where it
 * goes.
 *
 * `plain` drops the underline-on-hover styling for cases where the link is
 * already the dominant affordance (e.g. in a contact row where the whole
 * card might get an onClick later).
 */

import Link from 'next/link';

interface UsernameLinkProps {
  username: string;
  className?: string;
  /** Omit the leading `@`. The URL stays the same either way. */
  bare?: boolean;
  children?: React.ReactNode;
}

export function UsernameLink({
  username,
  className,
  bare,
  children,
}: UsernameLinkProps) {
  const base =
    className ??
    'text-[hsl(var(--text-muted))] underline-offset-2 hover:underline';
  return (
    <Link href={`/u/${username}`} className={base}>
      {children ?? (bare ? username : `@${username}`)}
    </Link>
  );
}
