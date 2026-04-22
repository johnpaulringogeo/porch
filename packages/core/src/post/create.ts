import { and, eq, or } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona, post, postAudience } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import {
  NotificationType,
  PostAudienceMode,
  PostMode,
  type Post,
} from '@porch/types/domain';
import { toApiPost } from './helpers.js';
import { toPublicPersona } from '../contact/helpers.js';
import { createNotification } from '../notification/index.js';

export interface PostActor {
  personaId: string;
}

export interface CreatePostInput {
  /** v0: always 'home'. Mode is fixed by the caller for forward-compat. */
  mode: PostMode;
  content: string;
  audienceMode: PostAudienceMode;
  /** Persona IDs; required iff audienceMode === 'selected'. */
  audiencePersonaIds?: string[];
}

/**
 * Create a Home-mode post on behalf of the actor persona.
 *
 * For `audienceMode: 'selected'`, every persona ID in `audiencePersonaIds`
 * must be a current mutual contact of the actor. We validate this explicitly
 * rather than silently dropping non-contacts — callers typically surfaced the
 * picker from a contact list, so a mismatch is a real bug worth surfacing.
 *
 * The insert + audience rows happen in one transaction so a post is never
 * half-created.
 */
export async function createPost(
  db: Database,
  actor: PostActor,
  input: CreatePostInput,
): Promise<Post> {
  if (input.mode !== PostMode.Home) {
    // v0 only supports Home. Accepting the field in the input shape is future-
    // proofing; we reject anything else loud-and-early here.
    throw new PorchError(
      ErrorCode.BadRequest,
      'Only Home-mode posts are supported in v0.',
      'mode',
    );
  }

  let audienceIds: string[] = [];
  if (input.audienceMode === PostAudienceMode.Selected) {
    audienceIds = input.audiencePersonaIds ?? [];
    if (audienceIds.length === 0) {
      throw new PorchError(
        ErrorCode.UnprocessableEntity,
        'audiencePersonaIds required when audienceMode is selected.',
        'audiencePersonaIds',
      );
    }
    // Every selected persona must be a current contact of the actor.
    const uniqueIds = Array.from(new Set(audienceIds));
    const rows = await db
      .select({ id: contact.contactPersonaId })
      .from(contact)
      .where(
        and(
          eq(contact.ownerPersonaId, actor.personaId),
          inContactIds(uniqueIds),
        ),
      );
    const foundIds = new Set(rows.map((r) => r.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new PorchError(
        ErrorCode.UnprocessableEntity,
        'One or more audience personas are not your contacts.',
        'audiencePersonaIds',
      );
    }
    audienceIds = uniqueIds;
  }

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(post)
      .values({
        authorPersonaId: actor.personaId,
        mode: input.mode,
        audienceMode: input.audienceMode,
        content: input.content,
      })
      .returning();
    if (!row) throw new Error('Failed to create post');

    if (input.audienceMode === PostAudienceMode.Selected && audienceIds.length > 0) {
      await tx.insert(postAudience).values(
        audienceIds.map((id) => ({
          postId: row.id,
          audiencePersonaId: id,
        })),
      );
    }

    return row;
  });

  const [authorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, actor.personaId))
    .limit(1);
  if (!authorRow) throw new Error('Author persona vanished mid-post');

  // Fan out one notification per audience persona for selected-mode posts.
  // Outside the tx so a stuck notification can't roll back the post — same
  // fire-and-forget posture as the contact handlers. all_contacts posts skip
  // this: those land in the home feed and don't warrant a per-recipient ping.
  if (input.audienceMode === PostAudienceMode.Selected && audienceIds.length > 0) {
    await Promise.all(
      audienceIds.map(async (recipientId) => {
        // Defensive: never notify the author about their own post. The
        // contact-validation above already prevents this in practice (you're
        // not in your own contact list), but a check here keeps the invariant
        // local to the fan-out.
        if (recipientId === actor.personaId) return;
        try {
          await createNotification(db, {
            recipientPersonaId: recipientId,
            type: NotificationType.PostSelectedAudience,
            payload: { postId: inserted.id, byPersonaId: actor.personaId },
          });
        } catch (err) {
          console.error('post-selected-audience-notify-failed', err);
        }
      }),
    );
  }

  return toApiPost(inserted, toPublicPersona(authorRow));
}

/**
 * `IN (...)` for persona IDs on the contact table. See contact/requests.ts for
 * the rationale on the hand-rolled helper — drizzle's `inArray` import path is
 * version-dependent and this avoids the extra import surface.
 */
function inContactIds(ids: string[]) {
  const [first, ...rest] = ids;
  if (!first) throw new Error('inContactIds called with empty list');
  let expr = eq(contact.contactPersonaId, first);
  for (const id of rest) {
    expr = or(expr, eq(contact.contactPersonaId, id))!;
  }
  return expr;
}
