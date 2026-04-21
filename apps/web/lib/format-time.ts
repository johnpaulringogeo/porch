/**
 * Short, locale-aware timestamp formatter shared across every post view
 * (home feed, profile, dashboard, permalink). Was duplicated in three files
 * before this; lifted the moment the fourth caller appeared.
 *
 * SSR returns the raw ISO string — the client upgrades it to a localized
 * "Oct 3, 2:14 PM" on hydration. The brief ISO flash is the price for not
 * shipping an i18n bundle just to format one timestamp, and it keeps the
 * server render deterministic (no timezone mismatch warnings).
 */
export function formatTimestamp(iso: string): string {
  if (typeof window === 'undefined') return iso;
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
