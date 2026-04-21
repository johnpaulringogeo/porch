import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, contactRequest, persona, post, postAudience } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { ContactStatus, type PublicProfile } from '@porch/types/api';
import {
  PersonaModerationState,
  PostAudienceMode,
  PostModerationState,
} from '@porch/types/domain';
import { toPublicPersona } from '../contact/helpers.js';

/**
 * Profile lookup.
 *
 * `getPersonaByUsername` is the raw lookup — used by routes that want the
 * full DB row. `getPublicProfile` is the view-shaped helper that every
 * profile-reading API surface should use: it applies the visibility rules
 * once, then enriches with counts and the viewer's contact status.
 *
 * Why suspended profiles 404 rather than returning a tombstone: v0 has no
 * "this user is suspended" UX, and the presence-or-absence distinction is
 * itself a leak vector. Restricted profiles *are* visible — restriction
 * limits their posting, not discovery.
 */

export interface ProfileViewer {
  /** null = unauthenticated (reserved for future; v0 routes are auth-gated). */
  personaId: string | null;
}

/**
 * Case-insensitive username lookup. Returns null when no match, when the
 * persona is archived, or when moderation state is `suspended`.
 */
export async function getPersonaByUsername(
  db: Database,
  username: string,
): Promise<typeof persona.$inferSelect | null> {
  const lower = username.toLowerCase();
  const [row] = await db
    .select()
    .from(persona)
    .where(and(eq(persona.username, lower), isNull(persona.archivedAt)))
    .limit(1);
  if (!row) return null;
  if (row.moderationState === PersonaModerationState.Suspended) return null;
  return row;
}

/**
 * Build the viewer-scoped profile view for `username`. Throws NotFound when
 * the persona doesn't exist, is archived, or is suspended. Counts and
 * contact status are computed relative to the viewer.
 *
 * `postCount` for a non-self viewer is the count of posts the viewer could
 * read individually — so the number matches the list on the profile page.
 * Self-viewer sees the full non-deleted count (moderated posts included,
 * mirroring their own /feed-adjacent my-posts view).
 */
export async function getPublicProfile(
  db: Database,
  viewer: ProfileViewer,
  username: string,
): Promise<PublicProfile> {
  const row = await getPersonaByUsername(db, username);
  if (!row) {
    throw new PorchError(ErrorCode.NotFound, 'No such user.');
  }

  const isSelf = viewer.personaId !== null && viewer.personaId === row.id;

  const contactStatus = await resolveContactStatus(db, viewer, row.id, isSelf);
  const postCount = await countVisiblePosts(db, row.id, viewer, isSelf);

  return {
    ...toPublicPersona(row),
    joinedAt: row.createdAt.toISOString(),
    postCount,
    contactStatus,
  };
}

// ── Contact status ──────────────────────────────────────────────────────────

async function resolveContactStatus(
  db: Database,
  viewer: ProfileViewer,
  subjectPersonaId: string,
  isSelf: boolean,
): Promise<ContactStatus> {
  if (isSelf) return ContactStatus.Self;
  if (!viewer.personaId) return ContactStatus.None;

  // Mutual-contact edge (stored symmetrically — one row either way is enough).
  const [edge] = await db
    .select({ owner: contact.ownerPersonaId })
    .from(contact)
    .where(
      and(
        eq(contact.ownerPersonaId, viewer.personaId),
        eq(contact.contactPersonaId, subjectPersonaId),
      ),
    )
    .limit(1);
  if (edge) return ContactStatus.Contact;

  // No edge — look for a pending request in either direction. The from/to
  // split tells us whether the viewer initiated it or is the recipient.
  const [pending] = await db
    .select({
      from: contactRequest.fromPersonaId,
      to: contactRequest.toPersonaId,
    })
    .from(contactRequest)
    .where(
      and(
        eq(contactRequest.status, 'pending'),
        or(
          and(
            eq(contactRequest.fromPersonaId, viewer.personaId),
            eq(contactRequest.toPersonaId, subjectPersonaId),
          ),
          and(
            eq(contactRequest.fromPersonaId, subjectPersonaId),
            eq(contactRequest.toPersonaId, viewer.personaId),
          ),
        ),
      ),
    )
    .limit(1);
  if (!pending) return ContactStatus.None;
  return pending.from === viewer.personaId
    ? ContactStatus.PendingOutgoing
    : ContactStatus.PendingIncoming;
}

// ── Post counting ──────────────────────────────────────────────────────────

/**
 * Count posts the viewer is allowed to see, authored by `authorPersonaId`.
 *
 * Splits by audience mode because the two visibility rules shape into
 * different queries: all_contacts is a single per-author/per-viewer edge
 * check (same count for every post), while selected needs a join against
 * post_audience per row. Combining in one query would need a correlated
 * EXISTS subquery — this Drizzle version isn't consistent about those, and
 * the two-query approach stays readable.
 */
async function countVisiblePosts(
  db: Database,
  authorPersonaId: string,
  viewer: ProfileViewer,
  isSelf: boolean,
): Promise<number> {
  if (isSelf) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(post)
      .where(
        and(eq(post.authorPersonaId, authorPersonaId), isNull(post.deletedAt)),
      );
    return row?.count ?? 0;
  }
  if (!viewer.personaId) return 0;

  const okStates = or(
    eq(post.moderationState, PostModerationState.Ok),
    eq(post.moderationState, PostModerationState.Limited),
  );

  // Part A: all_contacts posts — all-or-nothing based on whether the
  // author's contact list includes the viewer. One cheap existence probe.
  const [edge] = await db
    .select({ one: sql<number>`1` })
    .from(contact)
    .where(
      and(
        eq(contact.ownerPersonaId, authorPersonaId),
        eq(contact.contactPersonaId, viewer.personaId),
      ),
    )
    .limit(1);

  let allContactsCount = 0;
  if (edge) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(post)
      .where(
        and(
          eq(post.authorPersonaId, authorPersonaId),
          isNull(post.deletedAt),
          okStates,
          eq(post.audienceMode, PostAudienceMode.AllContacts),
        ),
      );
    allContactsCount = row?.count ?? 0;
  }

  // Part B: selected-audience posts — join against post_audience to keep
  // only rows where the viewer was explicitly picked.
  const [selRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(post)
    .innerJoin(postAudience, eq(postAudience.postId, post.id))
    .where(
      and(
        eq(post.authorPersonaId, authorPersonaId),
        isNull(post.deletedAt),
        okStates,
        eq(post.audienceMode, PostAudienceMode.Selected),
        eq(postAudience.audiencePersonaId, viewer.personaId),
      ),
    );
  const selectedCount = selRow?.count ?? 0;

  return allContactsCount + selectedCount;
}
