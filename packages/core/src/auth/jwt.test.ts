import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken, verifyAccessToken } from './jwt.js';

// Two distinct 48-byte keys encoded as base64 (matches what
// `openssl rand -base64 48` emits and what the API expects at runtime).
const KEY_A =
  'T3+ytLwN0VqYgiHHmJa4H8eP8K1V1i9tQ8mK0WBzAmQFqPEe9t8YwHnE6z0pnS/V';
const KEY_B =
  'hJWUcNn1fbtsTPhRgD+Pu5Y7u7Wk2EE0qRpwGnXbG8Z0nVgVrf2cPjVc0sL4V0rM';

const PAYLOAD = {
  sub: 'acct_01H8XYZ',
  persona: 'persona_01H8ABC',
  did: 'did:web:porch.example.com:users:alice',
  username: 'alice',
};

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips and preserves the claims', async () => {
    const { token, expiresAt, jti } = await signAccessToken(KEY_A, PAYLOAD);

    const claims = await verifyAccessToken(KEY_A, token);

    expect(claims.sub).toBe(PAYLOAD.sub);
    expect(claims.persona).toBe(PAYLOAD.persona);
    expect(claims.did).toBe(PAYLOAD.did);
    expect(claims.username).toBe(PAYLOAD.username);
    expect(claims.jti).toBe(jti);
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
    // expiresAt returned by sign should match the exp claim.
    expect(Math.floor(expiresAt.getTime() / 1000)).toBe(claims.exp);
  });

  it('issues a unique jti per sign', async () => {
    const a = await signAccessToken(KEY_A, PAYLOAD);
    const b = await signAccessToken(KEY_A, PAYLOAD);
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });

  it('sets exp 15 minutes after iat', async () => {
    const { token } = await signAccessToken(KEY_A, PAYLOAD);
    const claims = await verifyAccessToken(KEY_A, token);
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  it('rejects a token verified with a different key', async () => {
    const { token } = await signAccessToken(KEY_A, PAYLOAD);
    await expect(verifyAccessToken(KEY_B, token)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const { token } = await signAccessToken(KEY_A, PAYLOAD);
    // Flip one character in the payload segment.
    const [header, payload, sig] = token.split('.');
    const tampered = [header, payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A'), sig].join('.');
    await expect(verifyAccessToken(KEY_A, tampered)).rejects.toThrow();
  });

  it('rejects obviously malformed tokens', async () => {
    await expect(verifyAccessToken(KEY_A, 'not-a-jwt')).rejects.toThrow();
    await expect(verifyAccessToken(KEY_A, '')).rejects.toThrow();
  });

  describe('expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects an expired token', async () => {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      const { token } = await signAccessToken(KEY_A, PAYLOAD);

      // Fast-forward past the 15-minute TTL (plus a second to be safe).
      vi.setSystemTime(new Date('2026-01-01T12:15:01Z'));

      await expect(verifyAccessToken(KEY_A, token)).rejects.toThrow();
    });

    it('accepts a token still within its TTL', async () => {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      const { token } = await signAccessToken(KEY_A, PAYLOAD);

      vi.setSystemTime(new Date('2026-01-01T12:14:00Z'));

      const claims = await verifyAccessToken(KEY_A, token);
      expect(claims.sub).toBe(PAYLOAD.sub);
    });
  });
});
