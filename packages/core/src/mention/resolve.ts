import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona } from '@porch/db';
import { PostAudienceMode } from '@porch/types/domain';

/**
 * Context the resolver needs to decide who, of the set of mentioned handles,
 * is actually allowed to receive a notification for a given post.
 *
 * `audiencePersonaIds` is required (and assumed pre-validated to be the
 * author's contacts) when `audienceMode === 'selected'`. For `all_contacts`
 * it's ignored — the resolver queries the contact table directly.
 */
export interface MentionVisibilityContext {
  authorPersonaId: string;
  audienceMode: PostAudienceMode;
  audiencePersonaIds?: string[];
}

/**
 * Given a set of already-lowercased mention handles (as produced by
 * `extractMentions`) and the post's visibility context, return the persona
 * IDs that should receive a mention notification.
 *
 * Filters applied, in order:
 *   1. Resolve handles → persona rows. Archived personas (`archivedAt IS
 *      NOT NULL`) are excluded — they've opted out of receiving anything.
 *      Unknown handles silently drop out; the author probably typo'd.
 *   2. Drop the author (self-mention). Mentioning yourself in your own
 *      post isn't a notification event.
 *   3. Audience gate:
 *        - `selected`: recipient must be in the hand-picked
 *          `audiencePersonaIds`. We already trust that set to be contacts.
 *        - `all_contacts`: recipient must be a current mutual contact of
 *          the author (one row in `contact` with ownerPersonaId=author and
 *          contactPersonaId=recipient).
 *      Mentioning a persona who exists but isn't in the audience is
 *      silently dropped — we don't want a mention ping to be a sidechannel
 *      for post visibility ("alice mentioned you in a post you can't see").
 *
 * Order of the returned IDs mirrors the input `usernames` array's first-
 * occurrence order so the fan-out log/audit trail stays predictable. Each
 * ID appears at most once, matching the extractor's dedup guarantee.
 *
 * Empty input → empty output, with no DB calls. Callers can early-return
 * on `extractMentions(...).length === 0` to skip this whole helper.
 *
 * Moderation state on the RECIPIENT isn't gated here — a persona who's
 * `restricted` or `suspended` can still receive notifications about the
 * world even if their own posting surface is limited. If that changes,
 * add a moderationState check alongside the archivedAt filter.
 */
export async function resolveVisibleMentions(
  db: Database,
  usernames: string[],
  context: MentionVisibilityContext,
): Promise<string[]> {
  if (usernames.length === 0) return [];

  // 1. Resolve handles → active personas.
  const rows = await db
    .select({ id: persona.id, username: persona.username })
    .from(persona)
    .where(
      and(inArray(persona.username, usernames), isNull(persona.archivedAt)),
    );
  if (rows.length === 0) return [];

  // Preserve extractor order. The input `usernames` is already lowercase and
  // deduped, so the position map is 1:1 with that.
  const position = new Map(usernames.map((u, i) => [u, i]));
  rows.sort((a, b) => {
    const pa = position.get(a.username) ?? Infinity;
    const pb = position.get(b.username) ?? Infinity;
    return pa - pb;
  });

  // 2. Drop self-mentions.
  const nonAuthorIds = rows
    .filter((r) => r.id !== context.authorPersonaId)
    .map((r) => r.id);
  if (nonAuthorIds.length === 0) return [];

  // 3. Audience gate.
  if (context.audienceMode === PostAudienceMode.Selected) {
    const audience = new Set(context.audiencePersonaIds ?? []);
    return nonAuthorIds.filter((id) => audience.has(id));
  }

  // all_contacts: check the contact table. One query scoped to the
  // candidates we've already narrowed down — bounded by the mention count,
  // not the author's full contact list.
  const contacts = await db
    .select({ id: contact.contactPersonaId })
    .from(contact)
    .where(
      and(
        eq(contact.ownerPersonaId, context.authorPersonaId),
        inArray(contact.contactPersonaId, nonAuthorIds),
      ),
    );
  const allowed = new Set(contacts.map((c) => c.id));
  return nonAuthorIds.filter((id) => allowed.has(id));
}
