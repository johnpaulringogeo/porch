import { and, desc, eq, or } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import type { Contact } from '@porch/types/domain';
import { toApiContact, toPublicPersona } from './helpers.js';
import type { ContactActor } from './requests.js';

/**
 * List the actor's mutual contacts, newest-established first.
 *
 * Contact rows are stored symmetrically (one per direction), so a single
 * `ownerPersonaId === actor` filter is enough — no joins back to the other
 * side required.
 */
export async function listContacts(
  db: Database,
  actor: ContactActor,
): Promise<Contact[]> {
  const rows = await db
    .select()
    .from(contact)
    .where(eq(contact.ownerPersonaId, actor.personaId))
    .orderBy(desc(contact.establishedAt));
  if (rows.length === 0) return [];

  // Batched persona lookup keyed by the *other* side of each edge.
  const otherIds = Array.from(new Set(rows.map((r) => r.contactPersonaId)));
  const personaRows = await db
    .select()
    .from(persona)
    .where(inIds(otherIds));
  const byId = new Map(personaRows.map((p) => [p.id, toPublicPersona(p)]));

  return rows.flatMap((row) => {
    const other = byId.get(row.contactPersonaId);
    if (!other) return []; // defensive — FK should guarantee this
    return [toApiContact(row, other)];
  });
}

/**
 * Remove a mutual contact. Drops both directional rows in one transaction so
 * the relationship is never half-deleted.
 *
 * Idempotency note: if no rows exist (already removed, or never were
 * contacts), we surface NotFound rather than silently succeeding — the UI
 * needs to know whether the action actually did anything.
 */
export async function removeContact(
  db: Database,
  actor: ContactActor,
  contactPersonaId: string,
): Promise<void> {
  if (contactPersonaId === actor.personaId) {
    throw new PorchError(
      ErrorCode.BadRequest,
      'You can’t remove yourself as a contact.',
      'contactPersonaId',
    );
  }

  const removed = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(contact)
      .where(
        or(
          and(
            eq(contact.ownerPersonaId, actor.personaId),
            eq(contact.contactPersonaId, contactPersonaId),
          ),
          and(
            eq(contact.ownerPersonaId, contactPersonaId),
            eq(contact.contactPersonaId, actor.personaId),
          ),
        ),
      )
      .returning();
    return deleted.length;
  });

  if (removed === 0) {
    throw new PorchError(ErrorCode.NotFound, 'No such contact.');
  }
}

/**
 * Local copy of the `inIds` helper from requests.ts — kept module-private to
 * avoid a circular import. See requests.ts for the rationale (drizzle's
 * `inArray` import path is version-dependent).
 */
function inIds(ids: string[]) {
  const [first, ...rest] = ids;
  if (!first) throw new Error('inIds called with empty list');
  let expr = eq(persona.id, first);
  for (const id of rest) {
    expr = or(expr, eq(persona.id, id))!;
  }
  return expr;
}
