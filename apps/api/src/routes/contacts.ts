import { Hono } from 'hono';
import type { Context } from 'hono';
import { ContactOps, AuditOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  CreateContactRequest,
  RespondToContactRequest,
  type CreateContactRequestResponse,
  type ListContactRequestsResponse,
  type ListContactsResponse,
  type RespondToContactRequestResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Contact routes.
 *
 *   GET    /                         list mutual contacts
 *   GET    /requests                 list pending incoming requests
 *   GET    /requests/outgoing        list pending outgoing requests
 *   POST   /requests                 send a contact request
 *   POST   /requests/:id/respond     accept or decline as recipient
 *   POST   /requests/:id/cancel      retract a pending request as sender
 *   DELETE /:personaId               drop a mutual contact
 *
 * All routes require auth. requireAuth populates `c.var.actor`; we lean on
 * core/contact for the invariants and just translate inputs/outputs +
 * write audit entries here.
 */
export const contactRoutes = new Hono<AppBindings>();

contactRoutes.use('*', requireAuth);

// ── List ───────────────────────────────────────────────────────────────────

contactRoutes.get('/', async (c) => {
  const actor = requireActor(c);
  const contacts = await ContactOps.listContacts(c.var.db, { personaId: actor.personaId });
  const payload: ListContactsResponse = { contacts };
  return c.json(payload);
});

contactRoutes.get('/requests', async (c) => {
  const actor = requireActor(c);
  const requests = await ContactOps.listIncomingRequests(c.var.db, {
    personaId: actor.personaId,
  });
  const payload: ListContactRequestsResponse = { requests };
  return c.json(payload);
});

contactRoutes.get('/requests/outgoing', async (c) => {
  const actor = requireActor(c);
  const requests = await ContactOps.listOutgoingRequests(c.var.db, {
    personaId: actor.personaId,
  });
  const payload: ListContactRequestsResponse = { requests };
  return c.json(payload);
});

// ── Mutations ──────────────────────────────────────────────────────────────

contactRoutes.post('/requests', async (c) => {
  const actor = requireActor(c);
  const body = CreateContactRequest.parse(await c.req.json());

  const request = await ContactOps.createRequest(
    c.var.db,
    { personaId: actor.personaId },
    body.toPersonaUsername,
    body.message,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'contact.request.create',
    entityType: 'contact_request',
    entityId: request.id,
    metadata: { toPersonaId: request.to.id },
    ipAddress,
    userAgent,
  });

  const payload: CreateContactRequestResponse = { request };
  return c.json(payload, 201);
});

contactRoutes.post('/requests/:id/respond', async (c) => {
  const actor = requireActor(c);
  const requestId = c.req.param('id');
  const body = RespondToContactRequest.parse(await c.req.json());

  const request = await ContactOps.respondToRequest(
    c.var.db,
    { personaId: actor.personaId },
    requestId,
    body.accept,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: body.accept ? 'contact.request.accept' : 'contact.request.decline',
    entityType: 'contact_request',
    entityId: request.id,
    metadata: { fromPersonaId: request.from.id },
    ipAddress,
    userAgent,
  });

  // On accept, surface the actor-side mutual edge so the client can drop the
  // new contact straight into its list without a refetch. We synthesize from
  // the request rather than hitting the DB again — establishedAt is "now".
  const payload: RespondToContactRequestResponse = body.accept
    ? {
        request,
        contact: {
          persona: request.from,
          nickname: null,
          establishedAt: request.respondedAt ?? new Date().toISOString(),
        },
      }
    : { request };
  return c.json(payload);
});

contactRoutes.post('/requests/:id/cancel', async (c) => {
  const actor = requireActor(c);
  const requestId = c.req.param('id');

  const request = await ContactOps.cancelRequest(
    c.var.db,
    { personaId: actor.personaId },
    requestId,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'contact.request.cancel',
    entityType: 'contact_request',
    entityId: request.id,
    metadata: { toPersonaId: request.to.id },
    ipAddress,
    userAgent,
  });

  const payload: CreateContactRequestResponse = { request };
  return c.json(payload);
});

contactRoutes.delete('/:personaId', async (c) => {
  const actor = requireActor(c);
  const contactPersonaId = c.req.param('personaId');

  await ContactOps.removeContact(
    c.var.db,
    { personaId: actor.personaId },
    contactPersonaId,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: actor.personaId,
    action: 'contact.remove',
    entityType: 'contact',
    entityId: contactPersonaId,
    ipAddress,
    userAgent,
  });

  return c.body(null, 204);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    // requireAuth should have populated this; defensive guard for typing.
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}

/**
 * See personas.ts — duplicated intentionally; a shared helper lands when a
 * third route needs it.
 */
function clientInfo(c: Context<AppBindings>): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  const cf = c.req.header('cf-connecting-ip');
  const xff = c.req.header('x-forwarded-for');
  const ipAddress = cf ?? xff?.split(',')[0]?.trim() ?? undefined;
  const userAgent = c.req.header('user-agent') ?? undefined;
  return { ipAddress, userAgent };
}
