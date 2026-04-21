import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '@porch/db';
import { contact, contactRequest, persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { NotificationType, type ContactRequest } from '@porch/types/domain';
import { createNotification } from '../notification/index.js';
import { toApiContactRequest, toPublicPersona } from './helpers.js';

/** Time since a declined/cancelled request before a fresh one can be sent again. */
export const CONTACT_REREQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface ContactActor {
  /** The active persona sending/receiving the request. */
  personaId: string;
}

/**
 * Create a contact request from the actor to the user with the given username.
 *
 * Enforces the invariants documented in ./index.ts:
 *   - Target must exist and not be archived.
 *   - Target cannot be the actor's own persona.
 *   - No existing mutual contact.
 *   - No pending request in either direction.
 *   - Cooldown since the last declined/cancelled request has elapsed.
 *
 * Writes a `contact_request_received` notification to the target persona.
 */
export async function createRequest(
  db: Database,
  actor: ContactActor,
  toUsername: string,
  message?: string,
): Promise<ContactRequest> {
  const lower = toUsername.toLowerCase();

  const [target] = await db
    .select()
    .from(persona)
    .where(and(eq(persona.username, lower), isNull(persona.archivedAt)))
    .limit(1);
  if (!target) {
    throw new PorchError(ErrorCode.NotFound, 'No such user.', 'toPersonaUsername');
  }
  if (target.id === actor.personaId) {
    throw new PorchError(
      ErrorCode.BadRequest,
      'You can’t send a contact request to yourself.',
      'toPersonaUsername',
    );
  }

  // Already mutual contacts? Contact rows are symmetric — one side is enough.
  const existingContact = await db
    .select({ owner: contact.ownerPersonaId })
    .from(contact)
    .where(
      and(eq(contact.ownerPersonaId, actor.personaId), eq(contact.contactPersonaId, target.id)),
    )
    .limit(1);
  if (existingContact.length > 0) {
    throw new PorchError(ErrorCode.Conflict, 'You are already contacts.');
  }

  // Pending request in either direction?
  const pending = await db
    .select({ id: contactRequest.id, fromPersonaId: contactRequest.fromPersonaId })
    .from(contactRequest)
    .where(
      and(
        eq(contactRequest.status, 'pending'),
        or(
          and(
            eq(contactRequest.fromPersonaId, actor.personaId),
            eq(contactRequest.toPersonaId, target.id),
          ),
          and(
            eq(contactRequest.fromPersonaId, target.id),
            eq(contactRequest.toPersonaId, actor.personaId),
          ),
        ),
      ),
    )
    .limit(1);
  const pendingRow = pending[0];
  if (pendingRow) {
    if (pendingRow.fromPersonaId === actor.personaId) {
      throw new PorchError(
        ErrorCode.Conflict,
        'You already have a pending request to this user.',
      );
    }
    throw new PorchError(
      ErrorCode.Conflict,
      'This user has already sent you a request — accept or decline theirs instead.',
    );
  }

  // Cooldown since the last declined/cancelled request from actor → target.
  const cooldownCutoff = new Date(Date.now() - CONTACT_REREQUEST_COOLDOWN_MS);
  const recent = await db
    .select({ id: contactRequest.id })
    .from(contactRequest)
    .where(
      and(
        eq(contactRequest.fromPersonaId, actor.personaId),
        eq(contactRequest.toPersonaId, target.id),
        or(eq(contactRequest.status, 'declined'), eq(contactRequest.status, 'cancelled')),
        gt(contactRequest.createdAt, cooldownCutoff),
      ),
    )
    .orderBy(desc(contactRequest.createdAt))
    .limit(1);
  if (recent.length > 0) {
    throw new PorchError(
      ErrorCode.Conflict,
      'Please wait before sending another request to this user.',
    );
  }

  const [inserted] = await db
    .insert(contactRequest)
    .values({
      fromPersonaId: actor.personaId,
      toPersonaId: target.id,
      message: message ?? null,
    })
    .returning();
  if (!inserted) throw new Error('Failed to create contact request');

  // Fire-and-forget — a stuck notification must not block the write.
  try {
    await createNotification(db, {
      recipientPersonaId: target.id,
      type: NotificationType.ContactRequestReceived,
      payload: { requestId: inserted.id, fromPersonaId: actor.personaId },
    });
  } catch (err) {
    console.error('contact-request-notify-failed', err);
  }

  const [actorPersona] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, actor.personaId))
    .limit(1);
  if (!actorPersona) throw new Error('Actor persona vanished mid-request');

  return toApiContactRequest(inserted, toPublicPersona(actorPersona), toPublicPersona(target));
}

/**
 * Accept or decline a pending request. Only the recipient can respond.
 *
 * On accept, creates two `contact` rows atomically (one per direction) and
 * writes a `contact_request_accepted` notification back to the original
 * sender. Decline just flips the status; no notification in v0 (kept quiet).
 */
export async function respondToRequest(
  db: Database,
  actor: ContactActor,
  requestId: string,
  accept: boolean,
): Promise<ContactRequest> {
  const [existing] = await db
    .select()
    .from(contactRequest)
    .where(eq(contactRequest.id, requestId))
    .limit(1);
  if (!existing) {
    throw new PorchError(ErrorCode.NotFound, 'Request not found.');
  }
  if (existing.toPersonaId !== actor.personaId) {
    throw new PorchError(ErrorCode.Forbidden, 'Only the recipient can respond to this request.');
  }
  if (existing.status !== 'pending') {
    throw new PorchError(
      ErrorCode.Conflict,
      `Request is already ${existing.status}.`,
    );
  }

  const respondedAt = new Date();
  const newStatus = accept ? 'accepted' : 'declined';

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contactRequest)
      .set({ status: newStatus, respondedAt })
      .where(and(eq(contactRequest.id, requestId), eq(contactRequest.status, 'pending')))
      .returning();
    if (!row) {
      // Lost the race — someone else resolved it in the meantime.
      throw new PorchError(ErrorCode.Conflict, 'Request was resolved by another action.');
    }

    if (accept) {
      await tx.insert(contact).values([
        {
          ownerPersonaId: existing.fromPersonaId,
          contactPersonaId: existing.toPersonaId,
        },
        {
          ownerPersonaId: existing.toPersonaId,
          contactPersonaId: existing.fromPersonaId,
        },
      ]);
    }

    return row;
  });

  if (accept) {
    try {
      await createNotification(db, {
        recipientPersonaId: existing.fromPersonaId,
        type: NotificationType.ContactRequestAccepted,
        payload: { requestId: existing.id, byPersonaId: actor.personaId },
      });
    } catch (err) {
      console.error('contact-accept-notify-failed', err);
    }
  }

  const [fromP, toP] = await Promise.all([
    db.select().from(persona).where(eq(persona.id, existing.fromPersonaId)).limit(1),
    db.select().from(persona).where(eq(persona.id, existing.toPersonaId)).limit(1),
  ]);
  const fromPersona = fromP[0];
  const toPersona = toP[0];
  if (!fromPersona || !toPersona) throw new Error('Persona row vanished mid-response');

  return toApiContactRequest(updated, toPublicPersona(fromPersona), toPublicPersona(toPersona));
}

/**
 * Sender-initiated cancel. Only the original requester may cancel, and only
 * while the request is still pending.
 */
export async function cancelRequest(
  db: Database,
  actor: ContactActor,
  requestId: string,
): Promise<ContactRequest> {
  const [existing] = await db
    .select()
    .from(contactRequest)
    .where(eq(contactRequest.id, requestId))
    .limit(1);
  if (!existing) {
    throw new PorchError(ErrorCode.NotFound, 'Request not found.');
  }
  if (existing.fromPersonaId !== actor.personaId) {
    throw new PorchError(ErrorCode.Forbidden, 'Only the sender can cancel this request.');
  }
  if (existing.status !== 'pending') {
    throw new PorchError(ErrorCode.Conflict, `Request is already ${existing.status}.`);
  }

  const [updated] = await db
    .update(contactRequest)
    .set({ status: 'cancelled', respondedAt: new Date() })
    .where(and(eq(contactRequest.id, requestId), eq(contactRequest.status, 'pending')))
    .returning();
  if (!updated) {
    throw new PorchError(ErrorCode.Conflict, 'Request was resolved by another action.');
  }

  const [fromP, toP] = await Promise.all([
    db.select().from(persona).where(eq(persona.id, existing.fromPersonaId)).limit(1),
    db.select().from(persona).where(eq(persona.id, existing.toPersonaId)).limit(1),
  ]);
  const fromPersona = fromP[0];
  const toPersona = toP[0];
  if (!fromPersona || !toPersona) throw new Error('Persona row vanished mid-cancel');

  return toApiContactRequest(updated, toPublicPersona(fromPersona), toPublicPersona(toPersona));
}

/** Pending requests inbound to the actor, newest first. */
export async function listIncomingRequests(
  db: Database,
  actor: ContactActor,
): Promise<ContactRequest[]> {
  return listRequestsForSide(db, actor, 'incoming');
}

/** Pending requests the actor has sent out, newest first. */
export async function listOutgoingRequests(
  db: Database,
  actor: ContactActor,
): Promise<ContactRequest[]> {
  return listRequestsForSide(db, actor, 'outgoing');
}

async function listRequestsForSide(
  db: Database,
  actor: ContactActor,
  side: 'incoming' | 'outgoing',
): Promise<ContactRequest[]> {
  const filter =
    side === 'incoming'
      ? eq(contactRequest.toPersonaId, actor.personaId)
      : eq(contactRequest.fromPersonaId, actor.personaId);

  const rows = await db
    .select()
    .from(contactRequest)
    .where(and(eq(contactRequest.status, 'pending'), filter))
    .orderBy(desc(contactRequest.createdAt));
  if (rows.length === 0) return [];

  // Single batched lookup for all counterparty personas.
  const counterpartyIds = Array.from(
    new Set(rows.map((r) => (side === 'incoming' ? r.fromPersonaId : r.toPersonaId))),
  );
  const personaRows = await db.select().from(persona).where(inIds(persona.id, counterpartyIds));
  const byId = new Map(personaRows.map((p) => [p.id, toPublicPersona(p)]));

  // Actor's own persona row — used for the near side of every returned request.
  const [actorRow] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, actor.personaId))
    .limit(1);
  if (!actorRow) throw new Error('Actor persona not found');
  const actorPublic = toPublicPersona(actorRow);

  return rows.flatMap((row) => {
    const counterpartyId = side === 'incoming' ? row.fromPersonaId : row.toPersonaId;
    const counterparty = byId.get(counterpartyId);
    if (!counterparty) return []; // defensive — shouldn't happen with FK integrity
    const from = side === 'incoming' ? counterparty : actorPublic;
    const to = side === 'incoming' ? actorPublic : counterparty;
    return [toApiContactRequest(row, from, to)];
  });
}

/**
 * Drizzle's `inArray` is ideal for this but the exact import path varies by
 * version; build an `or(eq(...), eq(...))` fallback that typechecks without a
 * new import. Empty-list callers short-circuit above so we always have ≥1 id.
 */
function inIds(col: typeof persona.id, ids: string[]) {
  const [first, ...rest] = ids;
  if (!first) throw new Error('inIds called with empty list');
  let expr = eq(col, first);
  for (const id of rest) {
    expr = or(expr, eq(col, id))!;
  }
  return expr;
}
