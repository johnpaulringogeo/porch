import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { notification, persona, type Database } from '@porch/db';
import type { PublicPersona } from '@porch/types/domain';
import { NotificationType } from '@porch/types/domain';
import type { ApiNotification } from '@porch/types/api';
import { toPublicPersona } from '../contact/helpers.js';

/**
 * Notifications — list / read / dismiss.
 *
 * v0 writers: contact/requests.ts fires ContactRequestReceived and
 * ContactRequestAccepted. Others (post_moderated, account_moderated, system)
 * are reserved in the enum for later milestones.
 *
 * Reads are keyed by the recipient persona. The actor's persona context must
 * be the recipient — there's no cross-persona notification view. Keyset
 * pagination on (createdAt desc, id desc), matching the feed codec.
 *
 * Each returned row is enriched with an `actor` PublicPersona when the
 * payload references one (fromPersonaId / byPersonaId). The enrichment is
 * a server-side batch join — we don't bake the sender's displayName into
 * the payload at write time, so the UI always shows the current handle.
 */

export interface CreateNotificationInput {
  recipientPersonaId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<void> {
  await db.insert(notification).values({
    recipientPersonaId: input.recipientPersonaId,
    type: input.type,
    payload: input.payload as never,
  });
}

// ── Cursor codec ───────────────────────────────────────────────────────────

export interface NotificationCursor {
  createdAt: string; // ISO timestamp
  id: string;
}

export function encodeCursor(c: NotificationCursor): string {
  return btoa(JSON.stringify(c));
}

export function decodeCursor(raw: string): NotificationCursor | null {
  try {
    const decoded = JSON.parse(atob(raw)) as NotificationCursor;
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── Listing ────────────────────────────────────────────────────────────────

export interface ListNotificationsParams {
  recipientPersonaId: string;
  limit: number;
  cursor?: NotificationCursor;
  includeDismissed?: boolean;
}

export interface ListNotificationsResult {
  notifications: ApiNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * Paginated list of the actor's notifications, newest first.
 *
 * Also returns the total `unreadCount` (rows with readAt IS NULL AND
 * dismissedAt IS NULL) so the UI can render a header badge without a second
 * round-trip. That count is always global — not scoped to the returned page.
 */
export async function listNotifications(
  db: Database,
  params: ListNotificationsParams,
): Promise<ListNotificationsResult> {
  const { recipientPersonaId, limit, cursor, includeDismissed = false } = params;

  const mine = eq(notification.recipientPersonaId, recipientPersonaId);
  const baseConditions = includeDismissed
    ? mine
    : and(mine, isNull(notification.dismissedAt));

  const conditions = cursor
    ? and(
        baseConditions,
        or(
          lt(notification.createdAt, new Date(cursor.createdAt)),
          and(
            eq(notification.createdAt, new Date(cursor.createdAt)),
            lt(notification.id, cursor.id),
          ),
        ),
      )
    : baseConditions;

  const rows = await db
    .select()
    .from(notification)
    .where(conditions)
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
      : null;

  // Resolve actor personas referenced in payloads. One round-trip regardless
  // of page size — batch via inArray.
  const actorIds = Array.from(
    new Set(
      page
        .map(extractActorPersonaId)
        .filter((id): id is string => id !== null),
    ),
  );
  const actorMap = new Map<string, PublicPersona>();
  if (actorIds.length > 0) {
    const actors = await db
      .select()
      .from(persona)
      .where(inArray(persona.id, actorIds));
    for (const p of actors) {
      actorMap.set(p.id, toPublicPersona(p));
    }
  }

  const unreadCount = await getUnreadCount(db, recipientPersonaId);

  return {
    notifications: page.map((row) => {
      const actorId = extractActorPersonaId(row);
      const actor = actorId ? actorMap.get(actorId) ?? null : null;
      return toApiNotification(row, actor);
    }),
    nextCursor,
    unreadCount,
  };
}

/**
 * Count unread-and-not-dismissed for a persona. Pulled out so the write
 * paths can reuse it without duplicating the predicate.
 */
export async function getUnreadCount(
  db: Database,
  recipientPersonaId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.recipientPersonaId, recipientPersonaId),
        isNull(notification.readAt),
        isNull(notification.dismissedAt),
      ),
    );
  return row?.count ?? 0;
}

// ── Mutations ──────────────────────────────────────────────────────────────

export interface NotificationActor {
  personaId: string;
}

export interface WriteResult {
  updated: number;
  unreadCount: number;
}

export interface MarkReadInput {
  ids?: string[];
  all?: boolean;
}

/**
 * Mark notifications as read. If `all: true`, every unread-and-not-dismissed
 * row owned by the actor is updated. Otherwise `ids` must be non-empty; rows
 * not owned by the actor are silently ignored (no leaking existence).
 *
 * Idempotent: already-read rows are excluded from the update, so the
 * `updated` count reflects only rows actually flipped.
 */
export async function markRead(
  db: Database,
  actor: NotificationActor,
  input: MarkReadInput,
): Promise<WriteResult> {
  const mine = eq(notification.recipientPersonaId, actor.personaId);
  const whereClause = input.all
    ? and(mine, isNull(notification.readAt), isNull(notification.dismissedAt))
    : and(
        mine,
        inArray(notification.id, input.ids ?? []),
        isNull(notification.readAt),
      );

  const updated = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(whereClause)
    .returning();

  const unreadCount = await getUnreadCount(db, actor.personaId);
  return { updated: updated.length, unreadCount };
}

export interface DismissInput {
  ids?: string[];
  all?: boolean;
}

/**
 * Soft-delete — sets dismissedAt. Dismissed rows fall out of the default
 * list view and no longer count toward unreadCount. Rows not owned by the
 * actor are silently ignored.
 */
export async function dismiss(
  db: Database,
  actor: NotificationActor,
  input: DismissInput,
): Promise<WriteResult> {
  const mine = eq(notification.recipientPersonaId, actor.personaId);
  const whereClause = input.all
    ? and(mine, isNull(notification.dismissedAt))
    : and(
        mine,
        inArray(notification.id, input.ids ?? []),
        isNull(notification.dismissedAt),
      );

  const updated = await db
    .update(notification)
    .set({ dismissedAt: new Date() })
    .where(whereClause)
    .returning();

  const unreadCount = await getUnreadCount(db, actor.personaId);
  return { updated: updated.length, unreadCount };
}

// ── Helpers ────────────────────────────────────────────────────────────────

type NotificationRow = typeof notification.$inferSelect;

/**
 * Look up the persona referenced in a payload. v0 notifications use
 * either `fromPersonaId` (contact_request_received) or `byPersonaId`
 * (contact_request_accepted). Returns null when neither field is a
 * string — including when the type doesn't reference a persona at all.
 */
function extractActorPersonaId(row: NotificationRow): string | null {
  const payload = (row.payload ?? null) as Record<string, unknown> | null;
  if (!payload) return null;
  const from = payload.fromPersonaId;
  if (typeof from === 'string') return from;
  const by = payload.byPersonaId;
  if (typeof by === 'string') return by;
  return null;
}

/**
 * DB row → API-safe ApiNotification. Stringifies timestamps and attaches
 * the resolved actor persona (null when none, or when the reference has
 * since been deleted).
 */
export function toApiNotification(
  row: NotificationRow,
  actor: PublicPersona | null,
): ApiNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    payload: row.payload as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    actor,
  };
}
