/**
 * Usernames that must never be assigned to an ordinary persona.
 *
 * The list covers operational endpoints, policy URLs, generic terms that would
 * be impersonation-friendly, and potentially-reclaimable names for future
 * organizational accounts. Maintained here rather than in a DB table because
 * changing it requires code review and deployment — and because the list
 * rarely changes.
 *
 * Anything listed here is also case-insensitively blocked (comparisons
 * normalize to lowercase before checking).
 */
export const RESERVED_USERNAMES = new Set<string>([
  // Platform and operational
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'help',
  'host',
  'login',
  'logout',
  'mail',
  'moderator',
  'porch',
  'root',
  'security',
  'signup',
  'staff',
  'support',
  'system',

  // Policy / meta URLs
  'about',
  'contact',
  'copyright',
  'privacy',
  'terms',
  'tos',
  'trust',

  // Routes and conventions
  'home',
  'feed',
  'settings',
  'search',
  'notifications',
  'profile',
  'explore',
  'well-known',

  // Common impersonation risks
  'anthropic',
  'porch-team',

  // Underscores vs. hyphens: users[s] tend to typo these — pre-block
  'null',
  'undefined',
  'everyone',
  'nobody',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}
