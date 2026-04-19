# Porch — Getting Started

Step-by-step walkthrough to get the freshly-scaffolded Porch monorepo
running on your machine and pushed to GitHub. Written for Windows
PowerShell (since that's what you're on); Mac/Linux differences are
called out inline.

---

## 0. Heads-up before you start

Porch is a much bigger stack than SermonForge. SermonForge is React +
Vite + Vercel + Supabase — relatively few moving parts. Porch in v0 is:

- a Hono API service (runs on Cloudflare Workers *or* Node)
- a Next.js 14 App Router web app
- Postgres via Neon (serverless Postgres)
- Drizzle ORM
- persona-key crypto (Ed25519 + AES-GCM + Argon2id)

Make sure you actually want to take this on before you sink an evening
into it. If yes, read on.

---

## 1. Get a clean local git repo

I scaffolded the code inside the Cowork sandbox and committed it there,
but the sandbox's `.git` can't come with you. I left a one-shot git
bundle (`porch.bundle`) next to `porch/` that contains that commit.

Open PowerShell in your `social-media-site` folder. From the `porch`
directory:

```powershell
# Initialise a fresh repo in place
git init -b main

# Fetch the scaffold commit from the bundle I left next door
git pull ../porch.bundle main
```

`git pull` will complain that untracked files would be overwritten.
That's expected — the files are already on disk from the workspace
folder, but git doesn't know them yet. Fix it with:

```powershell
git reset --hard FETCH_HEAD
```

That marks the existing files as tracked at the scaffold commit. The
files on disk don't actually change (bundle contents match byte-for-byte).

Verify:

```powershell
git log --oneline       # should show: Scaffold Porch v0 monorepo
git status              # should say: working tree clean
```

Then delete the bundle — it's one-time payload:

```powershell
del ..\porch.bundle
```

---

## 2. Install prerequisites

You already have Node from SermonForge. You need Node ≥ 20 and pnpm 9.

**pnpm install (Windows, no admin):**

```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

Close that PowerShell window and open a new one (so it picks up the new
PATH). Verify:

```powershell
pnpm --version
```

You may get a version newer than 9.1.0 — that's fine. The workspace's
`package.json` pins pnpm 9.1.0 via the `packageManager` field and pnpm
is backwards-compatible.

(Avoid `corepack enable` on Windows unless you run PowerShell as
administrator — corepack tries to write shims into `C:\Program Files\nodejs\`
which is admin-only.)

**Mac/Linux alternative:** `curl -fsSL https://get.pnpm.io/install.sh | sh -`

---

## 3. Install dependencies

```powershell
cd porch
pnpm install
```

Expect 1–2 minutes the first time. It's a workspace with 5 packages and
2 apps, so there are a lot of transitive deps. Subsequent installs are
much faster thanks to pnpm's content-addressable store.

---

## 4. Set up the database (Neon)

1. Sign up at [neon.tech](https://neon.tech). Free tier is fine for dev.
2. Create a project called `porch-dev`.
3. Copy the connection string. It will look like:
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

---

## 5. Configure environment variables

```powershell
copy .env.example .env.local
```

Generate the two secrets `.env.example` asks for. On Windows with
OpenSSL (Git Bash usually ships it; otherwise use WSL or Node):

```powershell
# If you have openssl:
openssl rand -base64 32      # for PERSONA_KEY_ENCRYPTION_KEY
openssl rand -base64 48      # for JWT_SIGNING_KEY

# If you don't, Node works too:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Edit `.env.local`:

- `DATABASE_URL` — Neon string from Step 4
- `PERSONA_KEY_ENCRYPTION_KEY` — first random output
- `JWT_SIGNING_KEY` — second random output
- `PORCH_HOST` — leave as `localhost%3A3000` for local dev
  (the `%3A` is intentional — it's a URL-encoded `:`, because
  `did:web` syntax uses `:` as a path separator)
- `WEB_ORIGIN` — `http://localhost:3000`
- `NEXT_PUBLIC_API_URL` — `http://localhost:8787`

Leave the R2 / email vars blank. Those land in later milestones.

---

## 6. Run database migrations

```powershell
pnpm db:generate      # generates SQL from the Drizzle schema
pnpm db:migrate       # applies it to your Neon database
```

If `db:generate` produces a new migration file under
`packages/db/src/migrations/`, that's expected — commit it later.

If `db:migrate` succeeds, your Neon database now has all the tables:
account, persona, persona_key, session, contact, contact_request, post,
post_audience, notification, audit_log, moderation_action.

---

## 7. Start the dev servers

```powershell
pnpm dev
```

Turbo boots both apps in parallel:

- **API** on <http://localhost:8787>
  - Hit <http://localhost:8787/api/health> — should return `{"status":"ok"}`
- **Web** on <http://localhost:3000>
  - Should show the placeholder Porch v0 landing page

Stop the servers with `Ctrl+C`.

---

## 8. Push to GitHub

Create an empty repo at `github.com/johnpaulringogeo/porch` (or whatever
name you want — *don't* let GitHub initialise it with a README/license,
or you'll have a merge conflict on first push).

Then:

```powershell
git remote add origin git@github.com:johnpaulringogeo/porch.git
git push -u origin main
```

CI will run automatically on first push. It will probably fail the
first time because `pnpm test` doesn't exist in any workspace yet —
that's expected, we'll wire that up in the next milestone.

---

## What to tackle next (in order)

1. **Confirm the scaffold runs end-to-end** — Steps 1–7 above. If
   something blows up that I can fix, tell me what.
2. **First real endpoint: signup → JWT.** Wire up `POST /api/auth/signup`
   and `POST /api/auth/login` using the logic already in `@porch/core/auth`.
   This is the smallest thing that proves the whole stack works.
3. **Persona creation flow on the web side.** A real form that calls
   the API, stores the JWT, and redirects to a dashboard.
4. **First DID document end-to-end test.** Create a persona, then
   hit `http://localhost:3000/.well-known/did/users/{username}/did.json`
   and see your real Ed25519 public key.

After that we're into mode-by-mode buildout — Home first, since that's
the spec we wrote first.

---

## Things that went wrong during setup (so you don't hit them again)

- **`git pull ../porch.bundle main` fails with "untracked working tree
  files would be overwritten."** Solution: `git reset --hard FETCH_HEAD`
  (see Step 1).
- **`corepack enable` fails with "EPERM: operation not permitted,
  open 'C:\Program Files\nodejs\yarn'."** Solution: use the pnpm
  standalone installer instead (see Step 2). Don't run corepack as
  admin unless you have a specific reason.
