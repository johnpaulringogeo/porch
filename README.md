# Porch

A five-mode social platform with persona-native identity. Home, Public, Community, Professional, Creators — one account, many personas, no cross-mode joins.

This repository is the v0 implementation. The specs live at `../spec/` (architecture, home, public, community, professional, creators, trust-and-safety, governance-and-charter, business-model, design-principles, roadmap, v0-implementation).

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Web:** Next.js 14 (App Router, Server Components)
- **API:** Hono (runs on Cloudflare Workers and Node.js)
- **DB:** Postgres (Neon serverless) with Drizzle ORM
- **Identity:** `did:web` per persona, Ed25519 keys
- **Auth:** Argon2id passwords, JWT access tokens, rotating opaque refresh tokens
- **UI:** Radix primitives + Tailwind + custom components
- **Language:** TypeScript strict

## Layout

```
apps/
  web/          Next.js front-end
  api/          Hono API
packages/
  db/           Drizzle schema + migrations
  core/         Framework-agnostic business logic
  ui/           Shared React components
  types/        Shared TypeScript types and zod schemas
```

## Getting started

```bash
# Install
pnpm install

# Copy env template and fill in values
cp .env.example .env.local

# Generate a Neon database URL and drop it in .env.local
# Generate the two secrets:
openssl rand -base64 32   # PERSONA_KEY_ENCRYPTION_KEY
openssl rand -base64 48   # JWT_SIGNING_KEY

# Generate and apply migrations
pnpm db:generate
pnpm db:migrate

# Run everything
pnpm dev
```

API at http://localhost:8787, web at http://localhost:3000.

## v0 scope

v0 is the minimum runnable Porch. See `../spec/v0-implementation.md` for the full spec. Quick summary:

- Account + login (email + password, Argon2id)
- Per-persona identity with `did:web` DIDs
- Multiple personas per account with explicit switching
- Home mode: text posts to selected contacts
- Mutual contact relationships
- Chronological feed of Home posts from contacts
- Per-persona notification queue (polled)
- Moderation skeleton with audit log
- 30-day account deletion grace

**Not in v0:** Public/Community/Professional/Creators modes, ATProto federation, media uploads, DMs, search, real-time delivery.

## Contributing

Single branch (`main`), direct push, Turbo + pnpm for everything. Type-check, lint, and test all pass before commit. See `CONTRIBUTING.md` (deferred — will be written before the first outside contributor lands).

## License

UNLICENSED for now. License selection is Phase 1 work (source-available with a "no surveillance capitalism" addendum is the current direction — see `../spec/business-model.md`).
