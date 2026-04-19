// Load .env.local from the repo root so drizzle-kit (generate / migrate /
// studio) can find DATABASE_URL without the caller having to export it.
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '../../.env.local' });

import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
} satisfies Config;
