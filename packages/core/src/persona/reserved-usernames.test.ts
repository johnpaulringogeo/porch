import { describe, expect, it } from 'vitest';
import { isReservedUsername, RESERVED_USERNAMES } from './reserved-usernames.js';

describe('isReservedUsername', () => {
  it('blocks canonical reserved names', () => {
    expect(isReservedUsername('admin')).toBe(true);
    expect(isReservedUsername('root')).toBe(true);
    expect(isReservedUsername('porch')).toBe(true);
    expect(isReservedUsername('well-known')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedUsername('Admin')).toBe(true);
    expect(isReservedUsername('ROOT')).toBe(true);
    expect(isReservedUsername('PoRcH')).toBe(true);
  });

  it('allows ordinary usernames', () => {
    expect(isReservedUsername('alice')).toBe(false);
    expect(isReservedUsername('matt-personal')).toBe(false);
    expect(isReservedUsername('user123')).toBe(false);
  });

  it('keeps the canary list intact', () => {
    // If someone accidentally removes a name from the set, this fails loudly.
    // Covers the categories the reserved list is supposed to guard.
    const canaries = [
      'admin', // platform
      'api', // platform
      'moderator', // platform
      'privacy', // policy
      'terms', // policy
      'feed', // route
      'notifications', // route
      'null', // typo-prone
    ];
    for (const name of canaries) {
      expect(RESERVED_USERNAMES.has(name)).toBe(true);
    }
  });
});
