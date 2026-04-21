import { Hono } from 'hono';
import type { Context } from 'hono';
import { PersonaOps, PostOps, AuditOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import {
  CreatePersonaRequest,
  ListPersonaPostsQuery,
  type CreatePersonaResponse,
  type GetPersonaProfileResponse,
  type ListPersonaPostsResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Persona routes.
 *
 *   GET    /                       list my personas            (stub)
 *   POST   /                       create a new persona
 *   POST   /switch                 switch active persona       (stub)
 *   PATCH  /:personaId             update persona              (stub)
 *   POST   /:personaId/archive     archive persona             (stub)
 *   GET    /:username/profile      public profile
 *   GET    /:username/posts        viewer-scoped post list (paginated)
 *
 * All routes require a valid access token; requireAuth populates `c.var.actor`.
 */
export const personaRoutes = new Hono<AppBindings>();

personaRoutes.use('*', requireAuth);

personaRoutes.get('/', (c) => c.json({ todo: 'list my personas' }, 501));

// ── Create ─────────────────────────────────────────────────────────────────

personaRoutes.post('/', async (c) => {
  const db = c.var.db;
  const env = c.env;
  const actor = c.var.actor;
  if (!actor) {
    // requireAuth should have populated this; defensive guard for the typing.
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }

  const body = CreatePersonaRequest.parse(await c.req.json());

  // Format + reserved-list + uniqueness. Throws PorchError with field='username'
  // on any failure — the error middleware maps it to 422/409.
  await PersonaOps.assertUsernameAvailable(db, body.username);

  // New personas are never default — the default is established at signup and
  // remains permanent in v0. isDefault toggles come via PATCH once we add it.
  const createdPersona = await PersonaOps.createPersona(db, {
    accountId: actor.accountId,
    username: body.username,
    displayName: body.displayName,
    bio: body.bio,
    isDefault: false,
    porchHost: env.PORCH_HOST,
    personaKeyEncryptionKey: env.PERSONA_KEY_ENCRYPTION_KEY,
  });

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(db, {
    accountId: actor.accountId,
    personaId: createdPersona.id,
    action: 'persona.create',
    entityType: 'persona',
    entityId: createdPersona.id,
    ipAddress,
    userAgent,
  });

  // Never include accountId, key material, or cross-persona linkage in this
  // response — createPersona already returns a sanitized view.
  const payload: CreatePersonaResponse = {
    persona: {
      id: createdPersona.id,
      username: createdPersona.username,
      displayName: createdPersona.displayName,
      did: createdPersona.did,
      bio: createdPersona.bio,
      isDefault: createdPersona.isDefault,
    },
  };
  return c.json(payload, 201);
});

// ── Profile / posts ────────────────────────────────────────────────────────

personaRoutes.get('/:username/profile', async (c) => {
  const actor = requireActor(c);
  const username = c.req.param('username');
  const profile = await PersonaOps.getPublicProfile(
    c.var.db,
    { personaId: actor.personaId },
    username,
  );
  const payload: GetPersonaProfileResponse = { profile };
  return c.json(payload);
});

personaRoutes.get('/:username/posts', async (c) => {
  const actor = requireActor(c);
  const username = c.req.param('username');

  // Resolve the author persona through the same gate the profile route uses
  // (archived/suspended both surface as NotFound) so an invisible author
  // can't leak posts via this endpoint.
  const author = await PersonaOps.getPersonaByUsername(c.var.db, username);
  if (!author) {
    throw new PorchError(ErrorCode.NotFound, 'No such user.');
  }

  const parsed = ListPersonaPostsQuery.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });

  const result = await PostOps.listPersonaPosts(
    c.var.db,
    { personaId: actor.personaId },
    author.id,
    { cursor: parsed.cursor, limit: parsed.limit },
  );

  const payload: ListPersonaPostsResponse = {
    posts: result.posts,
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

// ── Stubs (post-v0) ────────────────────────────────────────────────────────

personaRoutes.post('/switch', (c) => c.json({ todo: 'switch persona' }, 501));
personaRoutes.patch('/:personaId', (c) => c.json({ todo: 'update persona' }, 501));
personaRoutes.post('/:personaId/archive', (c) => c.json({ todo: 'archive persona' }, 501));

// ── Helpers ────────────────────────────────────────────────────────────────

function requireActor(c: Context<AppBindings>): Actor {
  const actor = c.var.actor;
  if (!actor) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing actor context');
  }
  return actor;
}

/**
 * Best-effort client-IP / user-agent extraction. Matches the helper in
 * auth.ts — duplicated intentionally to keep route files self-contained; a
 * shared helper lives on the to-do list once a third route needs it.
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
