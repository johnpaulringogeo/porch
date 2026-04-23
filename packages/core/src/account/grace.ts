/**
 * Deletion grace period. v0 hard-codes 30 days per spec §17 and §18; when we
 * add an admin-configurable policy in v1, this becomes the default fallback
 * rather than a compile-time constant.
 *
 * Exported so tests and the UI can compute the same cutoff without re-deriving
 * it from a raw duration expression.
 */
export const GRACE_PERIOD_DAYS = 30;
export const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
