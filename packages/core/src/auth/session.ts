import { eq, and, isNull, gt } from 'drizzle-orm';
import { session, type Database, type NewSession } from '@porch/db';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CreateSessionInput {
  accountId: string;
  activePersonaId: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Create a new session row and return the opaque refresh token to set as a
 * cookie. Only the token hash is persisted.
 */
export async function createSession(
  db: Database,
  input: CreateSessionInput,
): Promise<{ sessionId: string; refreshToken: string; expiresAt: Date }> {
  const { token, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const row: NewSession = {
    accountId: input.accountId,
    activePersonaId: input.activePersonaId,
    refreshTokenHash: tokenHash,
    expiresAt,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
  };

  const [created] = await db.insert(session).values(row).returning({ id: session.id });
  if (!created) throw new Error('Failed to create session');

  return { sessionId: created.id, refreshToken: token, expiresAt };
}

/**
 * Rotate the refresh token for an existing session.
 * Looks up by token hash, issues a new opaque token, updates the row.
 * Returns null if session is not found, revoked, or expired.
 */
export async function rotateSession(
  db: Database,
  currentRefreshToken: string,
): Promise<{
  sessionId: string;
  accountId: string;
  activePersonaId: string;
  refreshToken: string;
  expiresAt: Date;
} | null> {
  const currentHash = hashRefreshToken(currentRefreshToken);

  const rows = await db
    .select()
    .from(session)
    .where(
      and(
        eq(session.refreshTokenHash, currentHash),
        isNull(session.revokedAt),
        gt(session.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const { token: newToken, tokenHash: newHash } = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db
    .update(session)
    .set({
      refreshTokenHash: newHash,
      refreshedAt: new Date(),
      expiresAt: newExpiresAt,
    })
    .where(eq(session.id, row.id));

  return {
    sessionId: row.id,
    accountId: row.accountId,
    activePersonaId: row.activePersonaId,
    refreshToken: newToken,
    expiresAt: newExpiresAt,
  };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.update(session).set({ revokedAt: new Date() }).where(eq(session.id, sessionId));
}

export async function revokeSessionByRefreshToken(
  db: Database,
  refreshToken: string,
): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  await db
    .update(session)
    .set({ revokedAt: new Date() })
    .where(eq(session.refreshTokenHash, hash));
}

export async function setActivePersona(
  db: Database,
  sessionId: string,
  personaId: string,
): Promise<void> {
  await db.update(session).set({ activePersonaId: personaId }).where(eq(session.id, sessionId));
}
