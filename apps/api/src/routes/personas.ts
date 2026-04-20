import { Hono } from 'hono';
import type { Context } from 'hono';
import { PersonaOps, AuditOps } from '@porch/core';
import { ErrorCode, PorchError } from '@porch/types';
import { CreatePersonaRequest, type CreatePersonaResponse } from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { AppBindings } from '../bindings.js';

/**
 * Persona routes.
 *
 *   GET    /                       list my personas            (stub)
 *   POST   /                       create a new persona
 *   POST   /switch                 switch active persona       (stub)
 *   PATCH  /:personaId             update persona              (stub)
 *   POST   /:personaId/archive     archive persona             (stub)
 *   GET    /:username/profile      public profile              (stub)
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

// ── Stubs (post-v0) ────────────────────────────────────────────────────────

personaRoutes.post('/switch', (c) => c.json({ todo: 'switch persona' }, 501));
personaRoutes.patch('/:personaId', (c) => c.json({ todo: 'update persona' }, 501));
personaRoutes.post('/:personaId/archive', (c) => c.json({ todo: 'archive persona' }, 501));
personaRoutes.get('/:username/profile', (c) => c.json({ todo: 'public profile' }, 501));

// ── Helpers ────────────────────────────────────────────────────────────────

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
