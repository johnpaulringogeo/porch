import { Hono } from 'hono';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { Auth, PersonaOps, PostOps, AuditOps } from '@porch/core';
import { account } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import {
  CreatePersonaRequest,
  ListPersonaPostsQuery,
  SwitchPersonaRequest,
  UpdatePersonaRequest,
  type ArchivePersonaResponse,
  type CreatePersonaResponse,
  type GetPersonaProfileResponse,
  type ListMyPersonasResponse,
  type ListPersonaPostsResponse,
  type SessionResponse,
  type UpdatePersonaResponse,
} from '@porch/types/api';
import { requireAuth } from '../middleware/auth.js';
import type { Actor, AppBindings } from '../bindings.js';

/**
 * Persona routes.
 *
 *   GET    /                       list my personas
 *   POST   /                       create a new persona
 *   POST   /switch                 switch active persona (mints a fresh access token)
 *   PATCH  /:personaId             update persona (displayName / bio)
 *   POST   /:personaId/archive     soft-delete persona (sets archivedAt)
 *   GET    /:username/profile      public profile
 *   GET    /:username/posts        viewer-scoped post list (paginated)
 *
 * All routes require a valid access token; requireAuth populates `c.var.actor`.
 */
export const personaRoutes = new Hono<AppBindings>();

personaRoutes.use('*', requireAuth);

// ── List my personas ───────────────────────────────────────────────────────

personaRoutes.get('/', async (c) => {
  const actor = requireActor(c);
  const personas = await PersonaOps.listMyPersonas(
    c.var.db,
    actor.accountId,
    actor.personaId,
  );
  const payload: ListMyPersonasResponse = { personas };
  return c.json(payload);
});

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
    likeSummaries: result.likeSummaries,
    commentSummaries: result.commentSummaries,
    nextCursor: result.nextCursor,
  };
  return c.json(payload);
});

// ── Switch active persona ──────────────────────────────────────────────────

/**
 * Switch the current session to a different persona owned by the same
 * account, then mint a new access token bearing the new persona's claims.
 *
 * Why this lives here instead of in /api/auth: the refresh-token cookie is
 * scoped to /api/auth so it isn't sent on /api/personas calls. The access
 * token's `sid` claim is enough — we mutate session.active_persona_id by
 * sessionId and let the existing /refresh flow pick the new value up the
 * next time the access token expires.
 *
 * The refresh cookie itself is left alone: it's an opaque rotation
 * credential, not a persona binding. Subsequent /refresh calls will mint
 * tokens for whatever persona this update points the session at.
 */
personaRoutes.post('/switch', async (c) => {
  const actor = requireActor(c);
  const env = c.env;
  const body = SwitchPersonaRequest.parse(await c.req.json());

  // Validate target first — an invalid ID should 404 whether or not it's
  // the one we're already on. If the user picked their current persona,
  // resolveSwitchTarget still succeeds and the downstream update is a
  // no-op write; cheap enough to not warrant a special branch.
  const target = await PersonaOps.resolveSwitchTarget(
    c.var.db,
    actor.accountId,
    body.personaId,
  );

  // Mutate session.active_persona_id first; if the token mint then fails
  // we've left the session pointing at the new persona, but the user can
  // simply retry — and on the next /refresh they'd get a token for the
  // new persona anyway. The alternative ordering would mint a token that
  // disagrees with the persisted session, which is worse.
  await Auth.setActivePersona(c.var.db, actor.sessionId, target.id);

  const access = await Auth.signAccessToken(env.JWT_SIGNING_KEY, {
    sub: actor.accountId,
    persona: target.id,
    did: target.did,
    username: target.username,
    sid: actor.sessionId,
  });

  // Look up the account row so we can build the SessionResponse the same
  // way auth.ts does — keeps the client's session-handling code uniform
  // across signup/login/refresh/switch.
  const [acct] = await c.var.db
    .select()
    .from(account)
    .where(eq(account.id, actor.accountId))
    .limit(1);
  if (!acct) {
    throw new PorchError(ErrorCode.InternalError, 'Account row vanished mid-switch.');
  }

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: target.id,
    action: 'persona.switch',
    entityType: 'persona',
    entityId: target.id,
    ipAddress,
    userAgent,
  });

  const payload: SessionResponse = {
    account: {
      id: acct.id,
      email: acct.email,
      emailVerified: acct.emailVerifiedAt !== null,
    },
    persona: {
      id: target.id,
      username: target.username,
      displayName: target.displayName,
      did: target.did,
    },
    session: {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
    },
  };
  return c.json(payload);
});

// ── Update persona ─────────────────────────────────────────────────────────

/**
 * PATCH /api/personas/:personaId
 *
 * Edit the displayName and/or bio of a persona the viewer owns. Ownership
 * is enforced inside PersonaOps.updatePersona; archived/suspended targets
 * are rejected symmetrically with /switch so the lifecycle behaves the
 * same across mutation endpoints. Empty patches are no-op.
 */
personaRoutes.patch('/:personaId', async (c) => {
  const actor = requireActor(c);
  const personaId = c.req.param('personaId');
  const body = UpdatePersonaRequest.parse(await c.req.json());

  const updated = await PersonaOps.updatePersona(
    c.var.db,
    actor.accountId,
    personaId,
    { displayName: body.displayName, bio: body.bio },
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: updated.id,
    action: 'persona.update',
    entityType: 'persona',
    entityId: updated.id,
    // Log only the keys that changed, not the values — bio text can be
    // personally identifying and the audit log is lower-sensitivity than
    // the row itself.
    metadata: {
      fields: [
        ...(body.displayName !== undefined ? ['displayName'] : []),
        ...(body.bio !== undefined ? ['bio'] : []),
      ],
    },
    ipAddress,
    userAgent,
  });

  const payload: UpdatePersonaResponse = {
    persona: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      did: updated.did,
      bio: updated.bio,
      avatarUrl: updated.avatarUrl,
      isDefault: updated.isDefault,
    },
  };
  return c.json(payload);
});

// ── Archive persona ────────────────────────────────────────────────────────

/**
 * POST /api/personas/:personaId/archive
 *
 * Soft-delete a persona. The active persona is intentionally rejected here
 * (409) — archiving the persona you're currently acting as would leave the
 * session pointing at a hidden row. The UI should switch first; this route
 * doesn't auto-switch on the user's behalf so the side-effect stays
 * explicit. Default-persona and already-archived also 409; suspended 403.
 */
personaRoutes.post('/:personaId/archive', async (c) => {
  const actor = requireActor(c);
  const personaId = c.req.param('personaId');

  const archived = await PersonaOps.archivePersona(
    c.var.db,
    actor.accountId,
    actor.personaId,
    personaId,
  );

  const { ipAddress, userAgent } = clientInfo(c);
  void AuditOps.recordAudit(c.var.db, {
    accountId: actor.accountId,
    personaId: archived.id,
    action: 'persona.archive',
    entityType: 'persona',
    entityId: archived.id,
    ipAddress,
    userAgent,
  });

  // archivedAt was just set above — assert non-null for the type system.
  // If it's somehow null we'd rather throw an InternalError than serialize
  // a corrupt response.
  if (!archived.archivedAt) {
    throw new PorchError(
      ErrorCode.InternalError,
      'archivePersona returned a row with no archivedAt.',
    );
  }

  const payload: ArchivePersonaResponse = {
    persona: {
      id: archived.id,
      archivedAt: archived.archivedAt.toISOString(),
    },
  };
  return c.json(payload);
});

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
