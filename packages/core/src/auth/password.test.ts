import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

// A password comfortably over the 12-char minimum. Used across tests.
const GOOD_PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'a different but still sufficiently long passphrase';

describe('hashPassword', () => {
  it('rejects passwords shorter than 12 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 12/);
    await expect(hashPassword('12345678901')).rejects.toThrow(/at least 12/); // 11 chars
  });

  it('accepts passwords at the 12-character boundary', async () => {
    const hash = await hashPassword('123456789012');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('returns an argon2id-encoded hash', async () => {
    const hash = await hashPassword(GOOD_PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$/);
    // Encoded form embeds the parameters; sanity-check the ones we pinned.
    expect(hash).toContain('m=65536'); // 64 MB in KB
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=1');
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword(GOOD_PASSWORD);
    const b = await hashPassword(GOOD_PASSWORD);
    expect(a).not.toEqual(b);
  });
});

describe('verifyPassword', () => {
  it('round-trips a hashed password', async () => {
    const hash = await hashPassword(GOOD_PASSWORD);
    await expect(verifyPassword(GOOD_PASSWORD, hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(GOOD_PASSWORD);
    await expect(verifyPassword(OTHER_PASSWORD, hash)).resolves.toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(verifyPassword(GOOD_PASSWORD, 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword(GOOD_PASSWORD, '')).resolves.toBe(false);
  });
});
