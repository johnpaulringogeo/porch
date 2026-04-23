import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { and, eq, isNull } from 'drizzle-orm';
import { Auth, PersonaOps, AuditOps } from '@porch/core';
import { account, persona } from '@porch/db';
import { ErrorCode, PorchError } from '@porch/types';
import { SignupRequest, LoginRequest, type SessionResponse } from '@porch/types/api';
import type { AppBindings } from '../bindings.js';
import type { Context } from 'hono';

/**
 * Auth routes.
 *
 *   POST /signup   create account + default persona, return session
 *   POST /login    verify password, return session
 *   POST /refresh  rotate refresh token, mint new access token
 *   POST /logout   revoke refresh token
 *
 * Refresh tokens are opaque, 30-day, set as an httpOnly cookie scoped to
 * /api/auth so they're only sent to refresh and logout. Access tokens are
 * 15-min HS256 JWTs, returned in the body and held in memory by the client.
 */
export const authRoutes = new Hono<AppBindings>();

const REFRESH_COOKIE = 'porch_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Account lockout: after this many consecutive failed logins, lock for the TTL.
const FAILED_LOGIN_THRESHOLD = 10;
const LOCKOUT_TTL_MS = 15 * 60 * 1000;

// ── Signup ─────────────────────────────────────────────────────────────────

authRoutes.post('/signup', async (c) => {
  const db = c.var.db;
  const env = c.env;
  const body = SignupRequest.parse(await c.req.json());

  // Username must be free *and* well-formed *and* not reserved. Throws
  // PorchError with field='username' on any failure — error middleware turns
  // it into a 422/409.
  await PersonaOps.assertUsernameAvailable(db, body.username);

  // Email uniqueness — the DB has a unique constraint on account.email but
  // checking up-front gives a friendlier error than a constraint violation.
  const emailLower = body.email.toLowerCase();
  const existingAccount = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.email, emailLower))
    .limit(1);
  if (existingAccount.length > 0) {
    throw new PorchError(ErrorCode.Conflict, 'Email is already registered.', 'email');
  }

  const passwordHash = await Auth.hashPassword(body.password);

  // Account → persona → session. createPersona is itself transactional;
  // the outer flow isn't a single tx because each step depends on data the
  // previous step generated (account ID, persona ID). If createPersona fails
  // we'd be left with an orphaned account row — acceptable in v0; the user
  // can retry signup with the same email after we add a cleanup path.
  const [createdAccount] = await db
    .insert(account)
    .values({
      email: emailLower,
      passwordHash,
      ageAttestedAt: new Date(),
      ageJurisdiction: body.ageAttestation.jurisdiction.toUpperCase(),
    })
    .returning();
  if (!createdAccount) {
    throw new PorchError(ErrorCode.InternalError, 'Failed to create account.');
  }

  const createdPersona = await PersonaOps.createPersona(db, {
    accountId: createdAccount.id,
    username: body.username,
    displayName: body.displayName,
    isDefault: true,
    porchHost: env.PORCH_HOST,
    personaKeyEncryptionKey: env.PERSONA_KEY_ENCRYPTION_KEY,
  });

  const { ipAddress, userAgent } = clientInfo(c);

  const sess = await Auth.createSession(db, {
    accountId: createdAccount.id,
    activePersonaId: createdPersona.id,
    ipAddress,
    userAgent,
  });

  const access = await Auth.signAccessToken(env.JWT_SIGNING_KEY, {
    sub: createdAccount.id,
    persona: createdPersona.id,
    did: createdPersona.did,
    username: createdPersona.username,
    sid: sess.sessionId,
  });

  setRefreshCookie(c, sess.refreshToken);

  // Fire-and-forget — recordAudit swallows its own errors.
  void AuditOps.recordAudit(db, {
    accountId: createdAccount.id,
    personaId: createdPersona.id,
    action: 'auth.signup',
    entityType: 'account',
    entityId: createdAccount.id,
    ipAddress,
    userAgent,
  });

  const payload: SessionResponse = {
    account: {
      id: createdAccount.id,
      email: createdAccount.email,
      emailVerified: createdAccount.emailVerifiedAt !== null,
    },
    persona: {
      id: createdPersona.id,
      username: createdPersona.username,
      displayName: createdPersona.displayName,
      did: createdPersona.did,
    },
    session: {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
    },
  };
  return c.json(payload, 201);
});

// ── Login ──────────────────────────────────────────────────────────────────

authRoutes.post('/login', async (c) => {
  const db = c.var.db;
  const env = c.env;
  const body = LoginRequest.parse(await c.req.json());

  const emailLower = body.email.toLowerCase();
  const rows = await db
    .select()
    .from(account)
    .where(eq(account.email, emailLower))
    .limit(1);
  const acct = rows[0];

  // Generic error message for both "no such account" and "wrong password" so
  // we don't leak which emails are registered.
  const invalidCredentials = () =>
    new PorchError(ErrorCode.Unauthorized, 'Invalid email or password.');

  if (!acct) throw invalidCredentials();

  // Lockout check first — even a correct password is rejected while locked.
  if (acct.lockedUntil && acct.lockedUntil.getTime() > Date.now()) {
    throw new PorchError(
      ErrorCode.RateLimited,
      'Too many failed attempts. Try again later.',
    );
  }

  // Status gate.
  //
  // `deletion_requested` is intentionally *not* gated here: the 30-day grace
  // window is only meaningful if the user can log back in to cancel it
  // (requestDeletion revokes all prior sessions). Once they're signed in
  // with the pending-deletion status, /api/account/me surfaces the grace
  // cutoff and /api/account/delete/cancel flips status back to active.
  //
  // `deleted` is terminal: the hard-delete job has either run or is about
  // to, and we don't want to hand out a fresh session against a row that's
  // mid-cleanup. Masked as "invalid credentials" to avoid confirming the
  // email was ever registered.
  if (acct.status === 'deleted') {
    throw invalidCredentials();
  }
  if (acct.status === 'suspended') {
    throw new PorchError(ErrorCode.Forbidden, 'This account is suspended.');
  }

  const ok = await Auth.verifyPassword(body.password, acct.passwordHash);
  if (!ok) {
    const nextCount = acct.failedLoginCount + 1;
    const shouldLock = nextCount >= FAILED_LOGIN_THRESHOLD;
    await db
      .update(account)
      .set({
        failedLoginCount: nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_TTL_MS) : acct.lockedUntil,
      })
      .where(eq(account.id, acct.id));
    throw invalidCredentials();
  }

  // Reset the failed-login counter on success.
  if (acct.failedLoginCount > 0 || acct.lockedUntil) {
    await db
      .update(account)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(account.id, acct.id));
  }

  // Pick the user's default persona (every signed-up account has one). If
  // they've archived their default we'd need a fallback path, but in v0 the
  // default persona is permanent.
  const personaRows = await db
    .select()
    .from(persona)
    .where(
      and(
        eq(persona.accountId, acct.id),
        eq(persona.isDefault, true),
        isNull(persona.archivedAt),
      ),
    )
    .limit(1);
  const defaultPersona = personaRows[0];
  if (!defaultPersona) {
    throw new PorchError(ErrorCode.InternalError, 'Account has no active persona.');
  }

  const { ipAddress, userAgent } = clientInfo(c);

  const sess = await Auth.createSession(db, {
    accountId: acct.id,
    activePersonaId: defaultPersona.id,
    ipAddress,
    userAgent,
  });

  const access = await Auth.signAccessToken(env.JWT_SIGNING_KEY, {
    sub: acct.id,
    persona: defaultPersona.id,
    did: defaultPersona.did,
    username: defaultPersona.username,
    sid: sess.sessionId,
  });

  setRefreshCookie(c, sess.refreshToken);

  void AuditOps.recordAudit(db, {
    accountId: acct.id,
    personaId: defaultPersona.id,
    action: 'auth.login',
    entityType: 'account',
    entityId: acct.id,
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
      id: defaultPersona.id,
      username: defaultPersona.username,
      displayName: defaultPersona.displayName,
      did: defaultPersona.did,
    },
    session: {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
    },
  };
  return c.json(payload);
});

// ── Refresh ────────────────────────────────────────────────────────────────

authRoutes.post('/refresh', async (c) => {
  const db = c.var.db;
  const env = c.env;
  const current = getCookie(c, REFRESH_COOKIE);
  if (!current) {
    throw new PorchError(ErrorCode.Unauthorized, 'Missing refresh token.');
  }

  const rotated = await Auth.rotateSession(db, current);
  if (!rotated) {
    // Token was unknown, expired, or revoked — clear the cookie so the
    // client doesn't keep retrying with a dead token.
    deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    throw new PorchError(ErrorCode.Unauthorized, 'Refresh token is invalid or expired.');
  }

  // Look up the account + active persona for the new access token.
  const [acct] = await db.select().from(account).where(eq(account.id, rotated.accountId)).limit(1);
  const [activePersona] = await db
    .select()
    .from(persona)
    .where(eq(persona.id, rotated.activePersonaId))
    .limit(1);
  if (!acct || !activePersona) {
    throw new PorchError(ErrorCode.Unauthorized, 'Account or persona no longer exists.');
  }

  const access = await Auth.signAccessToken(env.JWT_SIGNING_KEY, {
    sub: acct.id,
    persona: activePersona.id,
    did: activePersona.did,
    username: activePersona.username,
    sid: rotated.sessionId,
  });

  setRefreshCookie(c, rotated.refreshToken);

  const payload: SessionResponse = {
    account: {
      id: acct.id,
      email: acct.email,
      emailVerified: acct.emailVerifiedAt !== null,
    },
    persona: {
      id: activePersona.id,
      username: activePersona.username,
      displayName: activePersona.displayName,
      did: activePersona.did,
    },
    session: {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
    },
  };
  return c.json(payload);
});

// ── Logout ─────────────────────────────────────────────────────────────────

authRoutes.post('/logout', async (c) => {
  const db = c.var.db;
  const current = getCookie(c, REFRESH_COOKIE);
  if (current) {
    await Auth.revokeSessionByRefreshToken(db, current);
  }
  deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });

  const info = clientInfo(c);
  void AuditOps.recordAudit(db, {
    action: 'auth.logout',
    ipAddress: info.ipAddress,
    userAgent: info.userAgent,
  });

  return c.body(null, 204);
});

// ── Stubs (post-v0) ────────────────────────────────────────────────────────

authRoutes.post('/verify-email', (c) => c.json({ todo: 'verify-email' }, 501));
authRoutes.post('/request-password-reset', (c) =>
  c.json({ todo: 'request-password-reset' }, 501),
);
authRoutes.post('/reset-password', (c) => c.json({ todo: 'reset-password' }, 501));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Set the opaque refresh-token cookie. httpOnly so client JS can't read it,
 * scoped to /api/auth so it isn't sent on every API request, secure unless
 * we're on plain http (local dev only).
 */
function setRefreshCookie(c: Context<AppBindings>, token: string): void {
  const url = new URL(c.req.url);
  const isSecure = url.protocol === 'https:';
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Best-effort client-IP / user-agent extraction. Cloudflare sets
 * cf-connecting-ip; behind a node reverse proxy x-forwarded-for is the
 * convention. If neither is present we record undefined rather than guessing.
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
