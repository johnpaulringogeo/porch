import { z } from 'zod';
import type { Notification, NotificationType, PublicPersona } from '../domain/index.js';

/**
 * API-shaped notification. Extends the raw domain Notification with a
 * resolved `actor` — the persona named in the payload (fromPersonaId /
 * byPersonaId) if any. We resolve server-side so the UI can show the
 * sender's current displayName without a second round-trip and without
 * baking a possibly-stale snapshot into the payload at write time.
 *
 * `actor` is null for types that don't name a persona (system, etc.) or
 * when the referenced persona has been deleted since the notification was
 * written.
 */
export interface ApiNotification {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  actor: PublicPersona | null;
}

/**
 * GET /api/notifications
 *
 *   ?cursor         opaque keyset cursor (base64 of createdAt + id)
 *   ?limit          1..100, default 50
 *   ?includeDismissed  include dismissed rows (default false — treat the
 *                      dismiss pile as a trash bin)
 *
 * Response includes `unreadCount` so the header badge doesn't need a second
 * endpoint. The count is always the *total* unread+not-dismissed across all
 * pages, not just the page we're returning.
 */
export const ListNotificationsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeDismissed: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

export interface ListNotificationsResponse {
  notifications: ApiNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * POST /api/notifications/read
 *
 * Mark a specific set of notifications as read, or pass `all: true` to clear
 * every unread-and-not-dismissed row owned by the actor.
 */
export const MarkNotificationsReadRequest = z
  .object({
    ids: z.array(z.string().uuid()).max(500).optional(),
    all: z.boolean().optional(),
  })
  .refine(
    (val) => val.all === true || (val.ids !== undefined && val.ids.length > 0),
    { message: "Provide either 'all: true' or a non-empty 'ids' array." },
  );
export type MarkNotificationsReadRequest = z.infer<
  typeof MarkNotificationsReadRequest
>;

/**
 * POST /api/notifications/dismiss
 *
 * Soft-delete. Dismissed rows no longer appear in the default list and do
 * not count toward `unreadCount`.
 */
export const DismissNotificationsRequest = MarkNotificationsReadRequest;
export type DismissNotificationsRequest = z.infer<
  typeof DismissNotificationsRequest
>;

export interface NotificationWriteResponse {
  /** How many rows were actually affected (idempotent — already-marked rows return 0). */
  updated: number;
  unreadCount: number;
}

/**
 * Re-export the raw domain type so callers that don't need enrichment (e.g.
 * the count-only badge fetch) aren't forced to reference two modules.
 */
export type { Notification };
