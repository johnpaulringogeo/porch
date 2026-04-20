import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.test.ts'],
    // Argon2id with 64 MB memory is slow; give each test ample headroom.
    testTimeout: 30_000,
  },
});
