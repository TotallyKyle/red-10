# Deploying Red 10

Red 10 uses Socket.IO for realtime multiplayer, which means **the server needs
a long-running Node process that can hold WebSocket connections**. Vercel's
serverless model can't do that.

There are two ways to deploy. Pick one.

---

## Option A: Single host on Fly.io (recommended)

One deploy, one URL, no CORS. The server serves both the API and the built
client from the same origin. Easiest way to share a link with friends.

### Prerequisites

- Install the Fly CLI: `brew install flyctl` (or see [fly.io/docs](https://fly.io/docs/hands-on/install-flyctl/))
- Create an account: `fly auth signup`

### One-time setup

```bash
# Edit fly.toml and pick a unique app name (the current default is "red10")
# and a region near you (run `fly platform regions` for the list).

# Create the app on Fly (this doesn't deploy yet)
fly apps create <your-app-name>
```

### Deploy

```bash
fly deploy
```

That's it. Fly builds the Dockerfile, pushes the image, and runs the server.
Your app is live at `https://<your-app-name>.fly.dev`.

Share that URL with your friends.

### Auto-deploy on push to main (CI/CD)

The repo ships with two GitHub Actions workflows:
- `.github/workflows/ci.yml` — builds + runs tests on every push and PR.
- `.github/workflows/deploy.yml` — on push to `main`, re-runs tests, then
  deploys to Fly via `flyctl deploy --remote-only`.

One-time setup:

```bash
# 1. Create a deploy-scoped token (expires in 1 year by default).
#    Scoping limits blast radius vs. a full user token.
fly tokens create deploy -a red-10
# → copy the FlyV1 ... string it prints
```

Then add it to GitHub:

1. Go to **Settings → Secrets and variables → Actions** on the repo.
2. Click **New repository secret**.
3. Name: `FLY_API_TOKEN`, Value: paste the `FlyV1 ...` token.

That's it. Next push to `main` will build + test + deploy automatically.
Watch runs at `https://github.com/<user>/<repo>/actions`.

Rotating or revoking:

```bash
fly tokens list -a red-10
fly tokens revoke <token-id>
```

### Tweaks

- **Cold starts**: with `auto_stop_machines = "stop"`, the machine stops when
  idle and cold-starts on the next request (~1–2s). Flip to `"off"` in
  `fly.toml` for always-on (costs a few cents/day).
- **Multiple regions**: `fly scale count 2 --region sjc,iad` to run in two regions.

---

## Option B: Client on Vercel, Server on Fly.io (or Render/Railway)

Two deploys. Use this if you want Vercel specifically (e.g., custom domain
already configured there, or you like Vercel's preview deployments).

### Step 1 — Deploy the server

Same as Option A, but **don't** set `SERVE_CLIENT`. You want the server to be
API-only.

```bash
fly apps create red10-api
# Edit fly.toml:
#   - app = "red10-api"
#   - Remove SERVE_CLIENT=true OR set it to "false"
#   - Set CORS_ORIGIN to your Vercel URL (you'll know it after step 2)
fly deploy
```

For now, you can set `CORS_ORIGIN = "*"` to unblock yourself, then tighten
after the Vercel URL is known.

Note the server URL — something like `https://red10-api.fly.dev`.

### Step 2 — Deploy the client to Vercel

```bash
# From the repo root
npx vercel

# When prompted, accept defaults. Vercel will detect the monorepo and use
# vercel.json (which points to packages/client/dist).
```

In the Vercel dashboard, set the environment variable:

- **Name**: `VITE_API_URL`
- **Value**: `https://red10-api.fly.dev` (your server URL from step 1)
- **Environments**: Production (and Preview if you want)

Redeploy (Vercel → Deployments → ⋯ → Redeploy) so the new env var is baked
into the build.

### Step 3 — Tighten CORS on the server

Back in `fly.toml`, set:

```toml
CORS_ORIGIN = "https://<your-vercel-deployment>.vercel.app"
```

…and `fly deploy` again.

---

## Other platforms

The `Dockerfile` is standard, so any container platform works.

### Render

1. New → Web Service → connect your GitHub repo.
2. Environment: **Docker**.
3. Instance type: Free or Starter.
4. Env vars: `SERVE_CLIENT=true`, `CORS_ORIGIN=*` (or your client URL).
5. **Important**: WebSocket support is on by default. No extra config.

Note: Render's free tier sleeps after 15 min of inactivity, which will drop
in-progress games. Use the `$7/mo` Starter tier for persistent games.

### Railway

1. New Project → Deploy from GitHub → pick the repo.
2. Railway auto-detects the Dockerfile.
3. Env vars: `SERVE_CLIENT=true`, `CORS_ORIGIN=*`.
4. Railway gives you a `*.up.railway.app` URL.

Railway gives $5/mo credit; a tiny instance costs about that.

---

## Environment variables reference

### Server (`@red10/server`)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Port to listen on. Most platforms set this automatically. |
| `HOST` | `0.0.0.0` | Bind address. Leave as default for containers. |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins, or `*`. Ignored when client is same-origin. |
| `SERVE_CLIENT` | unset | Set to `true` to serve the built client from this server. |

### Client (`@red10/client`)

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | (same origin) | Explicit Socket.IO server URL. Set at **build time**, not runtime. |

---

## Bot review pipeline (optional)

The server can push every finished game's log + a structured JSON sidecar to a
private logs repo, where a Claude routine picks them up and posts a review
(see `.plans/review-pipeline.md`). If any of these three env vars is unset,
log pushing is a no-op and the game still plays normally.

```bash
# 1. Create the private logs repo
gh repo create TotallyKyle/red-10-logs --private

# 2. Make a fine-grained PAT scoped to that ONE repo with
#    "Contents: read and write". Copy the token.

# 3a. Fly: set as secrets
fly secrets set -a red-10 \
  GITHUB_TOKEN=ghp_xxx \
  LOGS_REPO=TotallyKyle/red-10-logs \
  ENV_LABEL=fly

# 3b. Local: add to .env (see .env.example)
```

---

## Local verification before deploying

```bash
# Build everything
npm run build

# Run the server in prod mode with client served from it
SERVE_CLIENT=true PORT=3099 node packages/server/dist/index.js

# Open http://localhost:3099 — you should see the lobby screen.
```

If that works, the deployed version will too.
