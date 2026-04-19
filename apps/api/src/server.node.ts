/**
 * Local-dev / self-hosted Node entry. Production runs on Cloudflare Workers
 * via `src/index.ts` + wrangler. This script wires the same Hono app to
 * @hono/node-server so we can `pnpm dev` without spinning up wrangler.
 */
// Load .env.local from the repo root before anything reads process.env.
// On Workers these come from wrangler.toml / secrets, not dotenv.
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '../../.env.local' });

import { serve } from '@hono/node-server';
import { createApp } from './index.js';
import { readEnv } from './env.js';

const env = readEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  PERSONA_KEY_ENCRYPTION_KEY: process.env.PERSONA_KEY_ENCRYPTION_KEY,
  JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY,
  PORCH_HOST: process.env.PORCH_HOST,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  // Tells dbMiddleware to use the postgres-js TCP driver (transactions work).
  PORCH_RUNTIME: 'node',
});

const app = createApp();
const port = Number(process.env.PORT ?? 8787);

serve(
  {
    fetch: (req) => app.fetch(req, env),
    port,
  },
  (info) => {
    console.info(`porch-api listening on http://localhost:${info.port}`);
  },
);
