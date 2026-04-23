# Porch deployment runbook

End-to-end walkthrough for getting Porch running on real infrastructure. This
is the checklist for v0 acceptance criterion #11 ("deploys to Cloudflare with
Neon, R2, and Postmark configured"). Follow top to bottom the first time;
reference specific sections on subsequent deploys.

Nothing in this doc is read by the running app — it's pure ops reference.

## Target architecture

| Layer | Host | Why |
| --- | --- | --- |
| API (`apps/api`) | Cloudflare Workers | Hono app, edge-resident, fits the Worker request model. |
| Web (`apps/web`) | Vercel | Next.js 14 App Router. Could also run on Cloudflare Pages, but Vercel is the default in this repo. |
| Postgres | Neon (serverless) | Pooled endpoint works from Workers without a TCP keep-alive problem. |
| Blob storage | Cloudflare R2 | S3-compatible, no egress fees when served via Workers. **Deferred to v0.5** (no code uses it in v0). |
| Email | Postmark | Transactional mail for verification + account alerts. **Deferred to v0.5** (verification flow lands with the job runner). |
| DNS | Cloudflare | Managing the zone at the same provider as Workers keeps `routes` ergonomic. |

The web app hosts both the user-facing UI *and* the `/.well-known/did/users/<u>/did.json` endpoint — `did:web:<host>` resolution lives on the web host, not the API worker, because the DID spec expects resolution at the bare public hostname. The web app proxies DB reads for that route through the API where needed (see `apps/web/app/.well-known/did/users/[username]/did.json/route.ts`).

## Prereqs

- pnpm 9.1+ installed locally.
- Cloudflare account.
- Neon account (free tier is fine for v0).
- Vercel account.
- Postmark account (can defer — no code path in v0).
- A domain you control, delegated to Cloudflare DNS.

## Part 1 — Cloudflare account + domain

1. In the Cloudflare dashboard: **Websites → Add a site** → enter your domain.
2. Follow the prompts to switch the domain's nameservers to Cloudflare. Wait until the zone is active (usually minutes).
3. Decide on the hostnames. Defaults assumed here:
   - `porch.example` — web app (Vercel)
   - `api.porch.example` — API worker
4. Leave DNS records empty for now — Vercel and Cloudflare's Worker routes will populate them.

## Part 2 — Neon database

1. Create a Neon project at `console.neon.tech`. Region: pick one near your Cloudflare Workers region. `us-east-2` is a safe default.
2. In the project, create a database named `porch` (the default `neondb` works too; match the name to the connection string you use).
3. Under **Connection Details**, grab the **Pooled connection string**. It looks like `postgresql://user:pass@ep-xyz-pooler.region.aws.neon.tech/porch?sslmode=require`. Use the pooled endpoint — the non-pooled one can exhaust connections from Workers.
4. (Optional) Create a separate `porch_staging` database for the staging env.
5. Save the pooled URL — you'll hand it to `wrangler secret put` below and to `pnpm drizzle-kit migrate` during the first deploy.

### Apply migrations

From your machine, with the Neon URL in your shell env as `DATABASE_URL`:

```powershell
pnpm --filter @porch/db drizzle-kit migrate
```

This walks `packages/db/src/migrations/*.sql` and applies anything unapplied. Safe to run repeatedly — Drizzle tracks the journal.

Every subsequent schema change that lands on `main` needs this command run against prod. Add it to the deploy checklist.

## Part 3 — API worker (Cloudflare)

### 3.1 Install wrangler and log in

```powershell
pnpm dlx wrangler@3 login
```

Follows the OAuth flow in the browser. Leaves credentials in `~/.config/.wrangler/`.

### 3.2 Name the worker

`apps/api/wrangler.toml` already sets `name = "porch-api"`. Edit if you want a different prefix. The worker's `*.workers.dev` URL will be `porch-api.<account-subdomain>.workers.dev`; that's fine for smoke tests but you'll route a real hostname to it next.

### 3.3 Configure the route

In `apps/api/wrangler.toml`, uncomment the production `[env.production.route]` block and set:

```toml
[env.production.route]
pattern = "api.porch.example/*"
zone_name = "porch.example"
```

Do the same for `[env.staging.route]` if you're using staging. Cloudflare adds the CNAME automatically on first deploy.

### 3.4 Set secrets

Run each of these and paste the value when prompted. The values come from the earlier steps + locally generated keys:

```powershell
# Production
wrangler secret put DATABASE_URL               --env production
wrangler secret put PERSONA_KEY_ENCRYPTION_KEY --env production   # openssl rand -base64 32
wrangler secret put JWT_SIGNING_KEY            --env production   # openssl rand -base64 48
wrangler secret put PORCH_ADMIN_ACCOUNT_IDS    --env production   # comma-separated UUIDs
```

Repeat with `--env staging` for staging.

Notes on the secret values:

- `PERSONA_KEY_ENCRYPTION_KEY` — 32 bytes base64. **Do not rotate** without a re-encryption migration; every persona's private signing key is encrypted under this key, so rotating it orphans them.
- `JWT_SIGNING_KEY` — 32+ bytes base64. Safe to rotate at any time. Rotation invalidates live access tokens; users are prompted to re-auth on the next refresh. Refresh cookies remain valid (they're opaque, not JWT).
- `PORCH_ADMIN_ACCOUNT_IDS` — accounts here bypass the `requireAdmin` gate on `/api/moderation/*/action`. Only list accounts you'd trust with moderator action. Admin identity gets a proper roles-table model in v0.5 (spec §11).

### 3.5 Non-secret vars

Already set in `wrangler.toml` per env. Edit the `PORCH_HOST` and `WEB_ORIGIN` values to match your actual domain before first deploy — they must match what personas' `did:web` identifiers get minted against.

### 3.6 Deploy

```powershell
pnpm --filter @porch/api deploy --env production
```

First deploy takes a minute while Cloudflare provisions the route + CNAME. Subsequent deploys are seconds.

## Part 4 — Web app (Vercel)

### 4.1 Create a Vercel project

1. `vercel login` (if you haven't).
2. From the repo root: `vercel link` — follow the prompts; set the **root directory** to `apps/web`.
3. In Vercel dashboard → **Settings → General**, confirm:
   - Framework preset: Next.js
   - Build command: `cd ../.. && pnpm install && pnpm --filter @porch/web build`
   - Output directory: `apps/web/.next`
   - Install command: (leave default — Vercel will figure pnpm out)

### 4.2 Domain

**Settings → Domains** → add `porch.example`. Vercel will print the required DNS records. Because the DNS is on Cloudflare:

1. Copy the Vercel-provided CNAME / A record target.
2. In Cloudflare DNS, add the record pointing `porch.example` (or the `www` subdomain) to the Vercel target. Set proxy status to **DNS only** (gray cloud) — Vercel handles its own TLS.

### 4.3 Environment variables

In Vercel **Settings → Environment Variables**, add per environment (Production, Preview):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled URL (the web app only uses this for `/.well-known/did/users/<u>/did.json`; read-only) |
| `PORCH_HOST` | `porch.example` (no scheme, no `%3A` encoding needed — this env is consumed by web, which just passes it through) |
| `NEXT_PUBLIC_API_URL` | `https://api.porch.example` |

Redeploy to pick them up (`vercel --prod` or git push).

## Part 5 — Smoke test

After both deploys finish, confirm the basic paths work. Replace the hostname with yours:

```powershell
# API health
curl https://api.porch.example/api/health

# Sign up a fresh account
curl -X POST https://api.porch.example/api/auth/signup `
  -H "Content-Type: application/json" `
  -d '{ "email": "you@example.com", "password": "a-strong-password-here", "username": "you", "displayName": "You", "ageAttestedAt": "2026-04-23T00:00:00Z", "ageJurisdiction": "US" }'

# Fetch the newly-created DID document
curl https://porch.example/.well-known/did/users/you/did.json

# Validate it — the response should pass validateDidDocument() in core tests.
# Manually eyeball: it should be JSON with @context, id=did:web:porch.example:users:you,
# one verificationMethod with an Ed25519VerificationKey2020 + z-prefixed publicKeyMultibase.
```

If the DID document resolves and looks spec-conformant, criterion #10 is satisfied on the deployed surface too (not just in unit tests).

## Part 6 — Cloudflare R2 (deferred to v0.5)

R2 is listed in the criterion but no v0 code uses it — upload flows ship with spec §18.1 in v0.5. To satisfy "configured" today:

1. In Cloudflare dashboard: **R2 → Create bucket** → `porch-media-prod` and `porch-media-staging`.
2. Create an API token: **R2 → Manage R2 API Tokens → Create API Token** → Object Read & Write, restrict to the two buckets.
3. Save the Access Key ID + Secret Access Key — they go into the deferred env vars (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) once the upload route lands.
4. When the upload code ships in v0.5, uncomment the `[[env.production.r2_buckets]]` block in `wrangler.toml` and bind the bucket to the worker.

Nothing else needed until then.

## Part 7 — Postmark (deferred to v0.5)

Also unused by v0 code; the email verification flow lands with the scheduled-job runner (spec §18.2). To satisfy "configured":

1. Sign up at `postmarkapp.com` and create a server for Porch.
2. Add and verify your sending domain (`porch.example`) — Postmark walks you through the SPF + DKIM DNS records.
3. Add those DNS records in Cloudflare DNS.
4. Grab the **Server API Token** from the Postmark dashboard.
5. Save it — it lands in `POSTMARK_SERVER_TOKEN` (wrangler secret) when the email worker route ships.

## Checklist

Use this for each environment (tick as you go):

- [ ] Cloudflare zone active for the domain
- [ ] Neon database created; pooled URL saved
- [ ] Drizzle migrations applied against Neon (`pnpm --filter @porch/db drizzle-kit migrate`)
- [ ] `wrangler.toml` route block uncommented + filled
- [ ] Wrangler secrets set: `DATABASE_URL`, `PERSONA_KEY_ENCRYPTION_KEY`, `JWT_SIGNING_KEY`, `PORCH_ADMIN_ACCOUNT_IDS`
- [ ] `wrangler.toml` vars updated: `PORCH_HOST`, `WEB_ORIGIN`
- [ ] `pnpm --filter @porch/api deploy --env production` succeeds
- [ ] Vercel project linked to `apps/web`, root directory correct
- [ ] Vercel domain added; Cloudflare DNS pointed at Vercel
- [ ] Vercel env vars set: `DATABASE_URL`, `PORCH_HOST`, `NEXT_PUBLIC_API_URL`
- [ ] Web redeployed
- [ ] `curl https://api.porch.example/api/health` returns 200
- [ ] Can sign up, log in, post, see feed on the deployed web app
- [ ] `curl https://porch.example/.well-known/did/users/<handle>/did.json` returns a spec-conformant DID document
- [ ] R2 buckets created (deferred wiring)
- [ ] Postmark server + DKIM/SPF configured (deferred wiring)

## Rotating secrets

- **`JWT_SIGNING_KEY`** — safe any time. `wrangler secret put JWT_SIGNING_KEY --env production`, redeploy. Live access tokens become invalid immediately; users re-auth on the next refresh.
- **`DATABASE_URL`** — safe; update the secret, redeploy. Neon's pooled URL survives password rotations if you use the same user; otherwise update both.
- **`PERSONA_KEY_ENCRYPTION_KEY`** — requires a data migration. Don't rotate without a plan.
- **`PORCH_ADMIN_ACCOUNT_IDS`** — add or remove UUIDs and redeploy. Change is effective on the next request.

## Troubleshooting

- **`wrangler deploy` succeeds but `/api/health` 500s** — secrets probably not set. Run `wrangler secret list --env production` and confirm all four are present. `readEnv()` in `apps/api/src/env.ts` throws on missing required keys.
- **Signup 500s with "Failed to create session"** — migrations haven't been applied against Neon. Re-run `pnpm --filter @porch/db drizzle-kit migrate` against the prod URL.
- **`did.json` returns `{"error":{"code":"CONFIG_ERROR"…}}`** — `PORCH_HOST` isn't set on Vercel. Add it to the web project's env vars and redeploy.
- **Login works once then `401`s on refresh** — `WEB_ORIGIN` doesn't match the actual web host, so the refresh cookie isn't sent. Update the wrangler var and redeploy.
- **CORS preflight errors from the web app** — same root cause: `WEB_ORIGIN` mismatch. Cross-check `wrangler.toml` vs. the URL the browser is loading.
