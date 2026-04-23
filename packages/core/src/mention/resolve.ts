import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona } from '@porch/db';
import { PostAudienceMode } from '@porch/types/domain';

/**
 * Context the resolver needs to decide who, of the set of mentioned handles,
 * is actually allowed to receive a notification for a given post.
 *
 * Two persona fields, deliberately separated so comment mentions work:
 *   - `authorPersonaId` is the *writer* — the persona who produced the text
 *     we're resolving mentions from. For a post mention, that's the post
 *     author. For a comment mention, that's the commenter.
 *   - `postAuthorPersonaId` is the persona whose audience governs visibility.
 *     For post mentions this is the same persona as the writer. For comment
 *     mentions it's the PARENT post's author — comments inherit the post's
 *     audience rules.
 *
 * If `postAuthorPersonaId` is omitted, it defaults to `authorPersonaId` —
 * keeping the post-mention caller shape unchanged while letting comment
 * callers override.
 *
 * `audiencePersonaIds` is required (and assumed pre-validated to be the
 * post author's contacts) when `audienceMode === 'selected'`. For
 * `all_contacts` it's ignored — the resolver queries the contact table
 * directly.
 */
export interface MentionVisibilityContext {
  /**
   * Persona who wrote the containing content (post author or commenter).
   * Self-mentions by this persona are filtered out — nobody wants a ping
   * for tagging themselves.
   */
  authorPersonaId: string;
  /**
   * Persona whose audience governs visibility — the owning post's author.
   * Defaults to `authorPersonaId` when absent (the post-mention case,
   * where writer and post-author are the same).
   */
  postAuthorPersonaId?: string;
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
 *   2. Drop the writer (self-mention). Mentioning yourself in your own
 *      content isn't a notification event.
 *   3. Audience gate. The post's author always passes this gate — a comment
 *      on Bob's post that mentions Bob should reach Bob, even though Bob
 *      isn't in his own `selected` audience list and isn't a contact of
 *      himself. For everyone else:
 *        - `selected`: recipient must be in the hand-picked
 *          `audiencePersonaIds`. We already trust that set to be contacts.
 *        - `all_contacts`: recipient must be a current mutual contact of
 *          the POST AUTHOR (one row in `contact` with
 *          ownerPersonaId=postAuthor and contactPersonaId=recipient).
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

  const postAuthorPersonaId =
    context.postAuthorPersonaId ?? context.authorPersonaId;

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

  // 2. Drop self-mentions (the writer).
  const nonWriterIds = rows
    .filter((r) => r.id !== context.authorPersonaId)
    .map((r) => r.id);
  if (nonWriterIds.length === 0) return [];

  // 3. Audience gate. Post author always passes — same rationale as the
  // visibility check in assertCanViewPost: the post author can always see
  // their own post, so a mention of them in a comment on it is reachable.
  //
  // Split the candidates into (post-author passes) + (needs-gating). We
  // still have to gate the rest.
  const needsGate: string[] = [];
  const passed: string[] = [];
  for (const id of nonWriterIds) {
    if (id === postAuthorPersonaId) {
      passed.push(id);
    } else {
      needsGate.push(id);
    }
  }

  if (needsGate.length === 0) {
    // Only the post author survived — return in the original order.
    return nonWriterIds.filter((id) => passed.includes(id));
  }

  let gated: Set<string>;
  if (context.audienceMode === PostAudienceMode.Selected) {
    gated = new Set(context.audiencePersonaIds ?? []);
  } else {
    // all_contacts: check the contact table. One query scoped to the
    // candidates we've already narrowed down — bounded by the mention count,
    // not the post author's full contact list.
    const contacts = await db
      .select({ id: contact.contactPersonaId })
      .from(contact)
      .where(
        and(
          eq(contact.ownerPersonaId, postAuthorPersonaId),
          inArray(contact.contactPersonaId, needsGate),
        ),
      );
    gated = new Set(contacts.map((c) => c.id));
  }

  // Merge the passed set with the gated survivors, preserving the original
  // extractor order.
  const allowed = new Set([...passed, ...needsGate.filter((id) => gated.has(id))]);
  return nonWriterIds.filter((id) => allowed.has(id));
}
