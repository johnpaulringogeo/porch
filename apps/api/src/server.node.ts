/**
 * Local-dev / self-hosted Node entry. Production runs on Cloudflare Workers
 * via `src/index.ts` + wrangler. This script wires the same Hono app to
 * @hono/node-server so we can `pnpm dev` without spinning up wrangler.
 */
import { serve } from '@hono/node-server';
import { createApp } from './index.js';
import { readEnv } from './env.js';

const env = readEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  PERSONA_KEY_ENCRYPTION_KEY: process.env.PERSONA_KEY_ENCRYPTION_KEY,
  JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY,
  PORCH_HOST: process.env.PORCH_HOST,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
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
